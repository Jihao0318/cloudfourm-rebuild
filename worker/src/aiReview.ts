// ============================================================
// AI 异步审核（Cloudflare Queues 消费端）
// 链路：发帖成功 → QUEUE.send({postId})（posts.ts producer）→ 本文件消费：
//       读 settings 开关 → 读帖 → 调 judge（JUDGE_API_URL/JUDGE_API_KEY secrets）→
//       flag 置 questionable（WHERE 守卫）→ 通知作者。
// 设计要点（照搬新项目已验证裁定）：
// - 开关关闭 → 跳过且不 throw（否则熔断写回后，队列里残留的旧消息会无限重试空转）
// - flag 置状态用 WHERE 守卫（仅 pending/cleared 可置 questionable），
//   0 行 = 已被巡查处理/重复消息 → 不通知不抛错
// - 通知失败仅 warn 不 throw（否则重试时帖子已 questionable 被守卫跳过 → 通知永久丢失且重试空转）
// - 熔断「先记后抛」：失败计数达阈值自动关 ai_review_enabled；任一成功清零计数
// - callJudge 对非 2xx / 非 JSON / verdict 非法一律 throw（触发队列内置重试，max_retries=3）
// ============================================================

import { getSetting, setSetting, createNotification } from './db/queries';
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

// 调用 judge 审核端点：POST env.JUDGE_API_URL（secrets JUDGE_API_KEY 走 x-judge-key header）
// 任何失败（非 2xx / 非 JSON / status==='error' / verdict 非法）一律 throw → 触发队列内置重试
async function callJudge(post: Pick<ReviewPostRow, 'title' | 'content'>, env: Env, timeoutMs: number): Promise<JudgeVerdict> {
  if (!env.JUDGE_API_URL || !env.JUDGE_API_KEY) {
    throw new Error('JUDGE_API_URL/JUDGE_API_KEY 未配置，无法执行 AI 审核');
  }
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-judge-key': env.JUDGE_API_KEY },
    body: JSON.stringify({ title: post.title, content: post.content }),
    // 超时由 settings ai_review_timeout_ms 控制（默认 5s）：judge 挂起时快速失败走队列重试
    signal: AbortSignal.timeout(timeoutMs),
  };
  // 双通道：配置了 JUDGE service binding 时走绑定（service binding 要求绝对 URL，host 不解析）；
  // 未绑定时走公网 fetch（JUDGE_API_URL 是自定义域名，不受 workers.dev 1042 子请求限制）
  const res = env.JUDGE
    ? await env.JUDGE.fetch(new Request(env.JUDGE_API_URL, init))
    : await fetch(env.JUDGE_API_URL, init);
  if (!res.ok) {
    throw new Error(`judge 返回非 2xx：HTTP ${res.status}`);
  }
  // 非 JSON 响应：res.json() 抛 SyntaxError 自然上抛触发重试，无需单独 catch
  const data: any = await res.json();
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

// 消费单条审核消息（queue handler 逐条调用）
export async function consumeAiReviewMessage(postId: number, env: Env): Promise<void> {
  const db = env.DB;

  // 1. 开关判定（默认 'true'——judge 端点已配置）：关闭 → 静默跳过且不 throw，
  //    否则熔断写回后队列里残留的旧消息会无限重试空转
  const enabled = (await getSetting(db, 'ai_review_enabled')) ?? 'true';
  if (enabled !== 'true') return;

  // 2. 读帖：消费侧重读内容（producer 只投 postId，避免大消息）；已软删 → 跳过
  const post = await db
    .prepare('SELECT id, user_id, title, content, review_status FROM posts WHERE id = ? AND deleted_at IS NULL')
    .bind(postId)
    .first<ReviewPostRow>();
  if (!post) return;

  // 3. 状态守卫：不在 pending/cleared → 已被巡查/复核处理或重复消息 → 跳过
  if (post.review_status !== 'pending' && post.review_status !== 'cleared') return;

  // 4. judge 超时（默认 5s，范围 100ms-60s）
  const timeoutMs = await numSetting(db, 'ai_review_timeout_ms', 5000, 100, 60000);

  // 5. 调 judge：任何 throw → 外层 catch 记熔断计数后 re-throw（走队列重试，max_retries=3）
  try {
    const verdict = await callJudge(post, env, timeoutMs);

    // 6. flag 处置：WHERE 守卫只允许 pending/cleared → questionable；
    //    meta.changes = 0 说明并发下已被巡查处理/重复消息 → 不通知不抛错
    if (verdict.verdict === 'flag') {
      const upd = await db
        .prepare("UPDATE posts SET review_status = 'questionable' WHERE id = ? AND review_status IN ('pending','cleared')")
        .bind(postId)
        .run();
      if ((upd.meta.changes || 0) > 0) {
        // 通知作者（系统通知：actorId=null 不触发「不给自己发通知」守卫）；user_id 为空的老数据跳过
        if (post.user_id != null) {
          const shortTitle = (post.title || '').slice(0, 30);
          const content = `🚫 你的帖子「${shortTitle}」被 AI 审核标记为疑似违规，已进入巡查复核。${verdict.summary ? '原因：' + verdict.summary : ''}`;
          try {
            await createNotification(db, post.user_id, null, 'system', postId, undefined, content);
          } catch (e) {
            // 通知失败仅记日志不 throw：重试时帖子已 questionable 被上方守卫跳过，
            // 若这里抛错只会造成无意义的重试空转，通知本身已永久丢失
            console.error(`ai_review.notify_failed post=${postId}:`, e);
          }
        }
      }
    }

    // 7. 任一成功即清零失败计数（熔断「连续失败」语义）
    await setSetting(db, 'ai_review_fail_count', '0');
  } catch (e) {
    // 「先记后抛」：先记熔断计数（达阈值自动关开关），再原样抛出让本批消息走队列重试
    await recordAiReviewFailure(env, postId, e);
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
