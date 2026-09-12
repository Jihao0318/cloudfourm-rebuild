// ============================================================
// AI 异步审核（Cloudflare Queues 消费端）
// 链路：发帖成功 → QUEUE.send({postId})（posts.ts producer）→ 本文件消费：
//       读 settings 开关 → 读帖 → 调 judge（JUDGE_API_URL/JUDGE_API_KEY secrets）→
//       三档置信度分流（阈值 ai_review_confidence_threshold，默认 70）：
//       不确定 → questionable 进「待复核」；确定 + pass → cleared 直接通过；
//       确定 + flag → 软删下架（可申诉恢复）→ 通知作者。
// 设计要点（照搬新项目已验证裁定）：
// - 开关关闭 → 跳过且不 throw（否则熔断写回后，队列里残留的旧消息会无限重试空转）
// - flag 置状态用 WHERE 守卫（仅 pending/cleared 可置 questionable），
//   0 行 = 已被巡查处理/重复消息 → 不通知不抛错
// - 通知失败仅 warn 不 throw（否则重试时帖子已 questionable 被守卫跳过 → 通知永久丢失且重试空转）
// - 熔断「先记后抛」：失败计数达阈值自动关 ai_review_enabled；任一成功清零计数
// - callJudge 对非 2xx / 非 JSON / verdict 非法一律 throw（触发队列内置重试，max_retries=3）
// ============================================================

import { getSetting, setSetting, createNotification } from './db/queries';
import { isSafeFetchUrl } from './utils/validation';
import type { Env } from './types';

// judge 响应（与 ai-review 服务 /api/judge 对齐）：{status, verdict: 'pass'|'flag', confidence, reasons, summary}
interface JudgeVerdict {
  verdict: 'pass' | 'flag';
  confidence?: number;
  reasons?: string[];
  summary?: string;
}

// 消费侧读帖的最小字段集
interface ReviewPostRow {
  id: number;
  user_id: number | null;
  title: string;
  content: string;
  review_status: string;
}

// settings 数值读取：非法（非数字）/越界一律回退 fallback（后台误配不致炸队列）
async function numSetting(db: D1Database, key: string, fallback: number, min: number, max: number): Promise<number> {
  const raw = await getSetting(db, key);
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

// 审核后端（管理后台可切换，settings ai_review_backend）：workers-ai = Cloudflare 官方 AI、gemini = Gemini。
// judge Worker 同时提供两个端点：service binding 只认路径、忽略 host，所以换个路径就等于换个后端
type JudgeBackend = 'workers-ai' | 'gemini';

/** 后端 → judge 端点路径（一个 Worker 两个路由，见审核服务 README） */
function judgePathFor(backend: JudgeBackend): string {
  return backend === 'gemini' ? '/gemini' : '/cfai';
}

// 调用 judge 审核端点：POST <JUDGE_API_URL 的 host>+/cfai 或 /gemini（secrets JUDGE_API_KEY 走 x-judge-key header）
// 任何失败（非 2xx / 非 JSON / status==='error' / verdict 非法）一律 throw → 触发队列内置重试
async function callJudge(post: Pick<ReviewPostRow, 'title' | 'content'>, env: Env, timeoutMs: number, backend: JudgeBackend): Promise<JudgeVerdict> {
  if (!env.JUDGE_API_URL || !env.JUDGE_API_KEY) {
    throw new Error('JUDGE_API_URL/JUDGE_API_KEY 未配置，无法执行 AI 审核');
  }
  // 出站 URL 安全校验：非 http/https 或指向内网/环回 → 配置错误，抛错走队列重试路径并触发熔断，不盲发
  if (!isSafeFetchUrl(env.JUDGE_API_URL)) {
    throw new Error('JUDGE_API_URL 指向不安全地址（内网/环回/非 http 协议）');
  }
  // 按后端改写路径（host 沿用 JUDGE_API_URL；走 binding 时 host 会被忽略，只有路径有意义）
  const judgeUrl = new URL(env.JUDGE_API_URL);
  judgeUrl.pathname = judgePathFor(backend);
  const endpoint = judgeUrl.toString();
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-judge-key': env.JUDGE_API_KEY },
    body: JSON.stringify({ title: post.title, content: post.content }),
    // 超时由 settings ai_review_timeout_ms 控制（默认 5s）：judge 挂起时快速失败走队列重试
    signal: AbortSignal.timeout(timeoutMs),
  };
  // 双通道：配置了 JUDGE service binding 时走绑定（service binding 要求绝对 URL，host 不解析）；
  // 未绑定时走公网 fetch（JUDGE_API_URL 是自定义域名，不受 workers.dev 1042 子请求限制）。
  // binding 通道返回 5xx 或抛错（本地 dev 无目标服务/线上偶发）时回退公网重试一次；4xx 直接按失败处理
  const classifyFetchErr = (err: any): Error => {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return new Error(`请求超时（${timeoutMs}ms）`);
    return new Error(`网络请求失败：${err?.message || '未知错误'}`);
  };
  let res: Response;
  try {
    if (env.JUDGE) {
      try {
        const bindingRes = await env.JUDGE.fetch(new Request(endpoint, init));
        if (bindingRes.status < 500) {
          res = bindingRes;
        } else {
          console.error('ai_review.judge_binding_5xx，回退公网:', bindingRes.status);
          res = await fetch(endpoint, init);
        }
      } catch (bindErr) {
        console.error('ai_review.judge_binding_error，回退公网:', bindErr);
        throw classifyFetchErr(bindErr);
      }
    } else {
      res = await fetch(env.JUDGE_API_URL, init);
    }
  } catch (fetchErr: any) {
    // fetch 层异常已结构化（超时/网络）则原样抛出，否则归一为网络失败
    throw fetchErr?.message?.startsWith('请求超时') || fetchErr?.message?.startsWith('网络请求失败') ? fetchErr : classifyFetchErr(fetchErr);
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`judge 返回 HTTP ${res.status}${bodyText ? `：${bodyText.slice(0, 200)}` : ''}`);
  }
  // 非 JSON 响应：显式归类为「响应不是有效 JSON」而非裸 SyntaxError
  const rawText = await res.text().catch(() => '');
  let data: any;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    throw new Error(`响应不是有效 JSON：${rawText.slice(0, 120)}`);
  }
  if (data?.status === 'error') {
    throw new Error(`judge 返回 error 状态：${data?.error || '未知错误'}`);
  }
  if (data?.verdict !== 'pass' && data?.verdict !== 'flag') {
    throw new Error(`judge verdict 非法：${JSON.stringify(data?.verdict)}`);
  }
  return {
    verdict: data.verdict as 'pass' | 'flag',
    confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
    reasons: Array.isArray(data.reasons) ? data.reasons : undefined,
    summary: typeof data.summary === 'string' ? data.summary : undefined,
  };
}

// 熔断记录：ai_review_fail_count +1 写 settings；连续失败达阈值（ai_review_circuit_break_threshold，
// 默认 20，范围 1-100）自动关 ai_review_enabled（写 'false'），让后续消息走「开关关闭 → 跳过」的静默路径。
// 内部整体 try/catch 只 console.error——记录失败绝不能打断「先记后抛」流程：
// 原始错误的 throw 由调用方负责（本函数只记录，不抛不吞）。
async function recordAiReviewFailure(env: Env, postId: number, cause: unknown): Promise<void> {
  try {
    const db = env.DB;
    const threshold = await numSetting(db, 'ai_review_circuit_break_threshold', 20, 1, 100);
    // fail_count 自身不设实际上限（max 取大数防越界回退把计数清零）
    const count = await numSetting(db, 'ai_review_fail_count', 0, 0, 1e15);
    const next = count + 1;
    await setSetting(db, 'ai_review_fail_count', String(next));
    if (next >= threshold) {
      await setSetting(db, 'ai_review_enabled', 'false');
      console.error(`ai_review.circuit_break post=${postId}: 连续失败 ${next} 次，已自动关闭 ai_review_enabled`, cause);
    } else {
      console.error(`ai_review.record_failure post=${postId} (${next}/${threshold}):`, cause);
    }
  } catch (e) {
    // 记录本身失败（如 D1 抖动）只打日志：不吞原始错误（调用方仍会 re-throw），也不能因记录失败二次 throw
    console.error(`ai_review.record_failure 写入失败 post=${postId}:`, e);
  }
}

// 写 AI 审核日志（巡查台「AI 审核日志」栏目数据源），同批次修剪只保留最近 20 条；
// 日志写失败只记 console，不影响审核主流程
async function writeAiReviewLog(
  db: D1Database,
  entry: {
    post: Pick<ReviewPostRow, 'id' | 'user_id' | 'title'>;
    verdict?: Omit<JudgeVerdict, 'confidence'> & { confidence?: number | null };
    action: 'approved' | 'uncertain' | 'takedown' | 'failed';
    error?: string;
  }
): Promise<void> {
  try {
    await db.batch([
      db.prepare(
        'INSERT INTO ai_review_logs (post_id, post_title, author_id, verdict, confidence, reasons, summary, action, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        entry.post.id,
        (entry.post.title || '').slice(0, 200),
        entry.post.user_id,
        entry.verdict?.verdict ?? null,
        entry.verdict?.confidence ?? null,
        entry.verdict?.reasons ? JSON.stringify(entry.verdict.reasons) : null,
        entry.verdict?.summary ?? null,
        entry.action,
        entry.error ?? null,
      ),
      // 只保留最近 20 条：每次插入后同批次修剪，表恒 ≤20 行
      db.prepare('DELETE FROM ai_review_logs WHERE id NOT IN (SELECT id FROM ai_review_logs ORDER BY id DESC LIMIT 20)'),
    ]);
  } catch (e) {
    console.error('ai_review.log_failed:', e);
  }
}

// 消费单条审核消息（queue handler 逐条调用）
export async function consumeAiReviewMessage(postId: number, env: Env): Promise<void> {
  const db = env.DB;

  // 1. 开关判定（默认 'true'——judge 端点已配置）：关闭 → 静默跳过且不 throw，
  //    否则熔断写回后队列里残留的旧消息会无限重试空转
  const enabled = (await getSetting(db, 'ai_review_enabled')) ?? 'true';
  if (enabled !== 'true') return;

  // 1.5 审核后端（管理后台可切换）：未设置或非法值一律按默认 workers-ai（Cloudflare 官方）。
  //     在读帖之前选好并记录，便于按日志排查某条消息走了哪条路由
  const backend: JudgeBackend = (await getSetting(db, 'ai_review_backend')) === 'gemini' ? 'gemini' : 'workers-ai';
  console.log(`ai_review.backend_selected backend=${backend} path=${judgePathFor(backend)} post=${postId}`);

  // 2. 读帖：消费侧重读内容（producer 只投 postId，避免大消息）；已软删 → 跳过
  const post = await db
    .prepare('SELECT id, user_id, title, content, review_status FROM posts WHERE id = ? AND deleted_at IS NULL')
    .bind(postId)
    .first<ReviewPostRow>();
  if (!post) return;

  // 3. 状态守卫：不在 pending/cleared → 已被巡查/复核处理或重复消息 → 跳过
  if (post.review_status !== 'pending' && post.review_status !== 'cleared') return;

  // 4. judge 超时（默认 5s，范围 100ms-60s）
  const timeoutMs = await numSetting(db, 'ai_review_timeout_ms', 15000, 100, 60000);

  // 5. 调 judge：任何 throw → 外层 catch 记熔断计数后 re-throw（走队列重试，max_retries=3）
  try {
    const verdict = await callJudge(post, env, timeoutMs, backend);

    // 6. 置信度三档分流（阈值 settings ai_review_confidence_threshold，0-100 整数，默认 70）：
    //    - 不确定（confidence 缺失或低于阈值，无论 verdict）→ questionable 进「待复核」，人工裁决
    //    - 确定 + pass → cleared 直接通过（免人工巡查）
    //    - 确定 + flag（AI 确定违规）→ AI 下架：软删 + flagged_by/flagged_reason 留痕 + 通知作者；
    //      作者可走「已下架复审」申诉，申诉通过后 appeals.ts 自动恢复并回 pending 重新巡查
    //    WHERE 守卫只允许 pending/cleared 的帖子被 AI 处置（questionable/violation/rejected 属人工领域，AI 不碰）；
    //    meta.changes = 0 说明并发下已被巡查处理/重复消息 → 不通知不抛错
    const thresholdPct = await numSetting(db, 'ai_review_confidence_threshold', 70, 50, 100);
    // 置信度归一化：llama 偶发输出 0（未给出有效判断）——0 与缺失同等视为「AI 未能判断」，
    // 入库记 NULL，展示层不再出现误导性的「置信度 0%」
    const confidence = verdict.confidence != null && verdict.confidence > 0 ? verdict.confidence : null;
    const normVerdict = { ...verdict, confidence };
    const certain = confidence != null && confidence >= thresholdPct / 100;
    if (!certain) {
      // 不确定 → 待复核（flagged_by/flagged_reason 留痕供复核员参考）
      const confText = confidence != null ? Math.round(confidence * 100) + '%' : '';
      const upd = await db
        .prepare("UPDATE posts SET review_status = 'questionable', flagged_by = 'ai', flagged_reason = ? WHERE id = ? AND review_status IN ('pending','cleared')")
        .bind(`AI 置信度不足${confText ? `（${confText}）` : ''}，无法确定是否合规`, postId)
        .run();
      if ((upd.meta.changes || 0) > 0 && post.user_id != null) {
        const shortTitle = (post.title || '').slice(0, 30);
        // 仅提醒「帖子可能有问题、已转人工复核」：帖子并未下架，所以不带申诉入口。
        // 注意通知类型必须用 system —— post_takedown 会渲染「去申诉」按钮（那是下架场景用的）
        const content = `🤔 你的帖子「${shortTitle}」可能存在问题：AI 审核无法确定是否违规${confText ? `（置信度 ${confText}）` : ''}，已转入人工复核，帖子目前仍正常显示`;
        try {
          await createNotification(db, post.user_id, null, 'system', postId, undefined, content);
        } catch (e) {
          // 通知失败仅记日志不 throw：重试时帖子状态已被守卫跳过，抛错只会造成无意义重试空转
          console.error(`ai_review.notify_failed post=${postId}:`, e);
        }
      }
      await writeAiReviewLog(db, { post, verdict: normVerdict, action: 'uncertain' });
    } else if (verdict.verdict === 'pass') {
      // 确定 + pass → **不改状态**：帖子保持 pending 照常进「待巡查」队列走人工投票；
      // AI 判定只作为参考（巡查卡片展示「AI 判定无问题 + 置信度」，数据来自 ai_review_logs）
      await writeAiReviewLog(db, { post, verdict: normVerdict, action: 'approved' });
    } else {
      // 确定 + flag → AI 下架（软删）：帖子确实被下架，通知里要保留申诉入口，
      // 故用 post_takedown 类型（前端对该类型展开后渲染「如有异议，请点击下方申诉」+ 申诉按钮，
      // 与手动下架的通知一致）；申诉通过后 appeals.ts 自动恢复并回 pending 重新巡查
      const reason = (verdict.summary || (verdict.reasons || []).join('；') || '违规内容').slice(0, 200);
      const upd = await db
        .prepare("UPDATE posts SET deleted_at = datetime('now'), flagged_by = 'ai', flagged_reason = ? WHERE id = ? AND review_status IN ('pending','cleared')")
        .bind(`AI 判定违规：${reason}`, postId)
        .run();
      if ((upd.meta.changes || 0) > 0 && post.user_id != null) {
        const shortTitle = (post.title || '').slice(0, 30);
        const content = `🚫 你的帖子「${shortTitle}」因违规被 AI 下架（原因：${reason}）`;
        try {
          await createNotification(db, post.user_id, null, 'post_takedown', postId, undefined, content);
        } catch (e) {
          console.error(`ai_review.notify_failed post=${postId}:`, e);
        }
      }
      await writeAiReviewLog(db, { post, verdict: normVerdict, action: 'takedown' });
    }

    // 7. 任一成功即清零失败计数（熔断「连续失败」语义）
    await setSetting(db, 'ai_review_fail_count', '0');
  } catch (e) {
    // 「先记后抛」：先记熔断计数（达阈值自动关开关），再原样抛出让本批消息走队列重试
    await recordAiReviewFailure(env, postId, e);
    await writeAiReviewLog(db, {
      post,
      action: 'failed',
      error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
    });
    throw e;
  }
}

// 批次入口（worker queue handler 调用）：for-of 逐条 await 处理，
// 单条失败即抛出让整批失败、由队列按 max_retries 重试（batch 内已成功条目重跑会被状态守卫跳过，幂等）
export async function consumeAiReviewBatch(batch: MessageBatch<{ postId: number }>, env: Env): Promise<void> {
  for (const m of batch.messages) {
    await consumeAiReviewMessage(m.body.postId, env);
  }
}
