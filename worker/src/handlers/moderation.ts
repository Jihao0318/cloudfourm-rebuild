import { Hono } from 'hono';
import type { Env, JWTPayload, User } from '../types';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { parseId } from '../utils/validation';
import { getSetting } from '../db/queries';
import { recordPatrolAction, patrolLevelFromExp, type PatrolStatsRow } from '../utils/patrol';

// 巡查体系 v2（068 迁移）：打回重新编辑 + 轮次隔离 + 双计数竞争 + 阈值配置化
// 状态机：pending(待巡查) → cleared(通过) / questionable(存疑) / violation(违规待复核) / rejected(打回待编辑)
// 待巡查队列：pass(没问题) / question(存疑) / violation(违规第 1 票)
// 待复核队列：pass(没问题) / confirm(确认违规)——两种票同时累积，先到各自阈值者生效，同时达标违规优先
// 阈值：patrol_pass_limit(默认 2) / patrol_violation_limit(默认 3)，后台可配
// 打回：rejected + rejected_at，扣 review_reject_coins(默认 50)，作者 1 天内修改重提（review_round+1，票数清零）
// 隐藏规则：本轮已投过任何票的巡查员不再看到该帖；管理员豁免（始终可见全部）
const moderation = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 子应用内部 use 对自身路由生效：先 requireAuth（设置 dbUser）再按角色放行
moderation.use('*', requireAuth);

// 「没问题」通过票数阈值（settings patrol_pass_limit 可配，默认 2）
async function passLimit(db: D1Database): Promise<number> {
  const v = await getSetting(db, 'patrol_pass_limit');
  const n = parseInt(v || '');
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 2;
}

// 违规（打回）票数阈值（settings patrol_violation_limit 可配，默认 3）
async function violationLimit(db: D1Database): Promise<number> {
  const v = await getSetting(db, 'patrol_violation_limit');
  const n = parseInt(v || '');
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 3;
}

// 打回/超时删除扣分（settings review_reject_coins 可配，默认 50）
async function rejectCoins(db: D1Database): Promise<number> {
  const v = await getSetting(db, 'review_reject_coins');
  const n = parseInt(v || '');
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : 50;
}

// 隐藏规则：巡查员投过任何票的内容不再显示给自己（避免重复劳动）
// 管理员豁免——始终可见全部内容（含自己投过的、自己的帖子），便于管理/调试
function queueVisibility(userId: number, isAdmin: boolean, queue: string): { where: string; params: any[] } {
  if (isAdmin) {
    return queue === 'flagged'
      ? { where: "p.review_status IN ('questionable','violation')", params: [] }
      : { where: "p.review_status = 'pending'", params: [] };
  }
  return queue === 'flagged'
    ? {
        where: "p.review_status IN ('questionable','violation') AND p.user_id != ? AND NOT EXISTS (SELECT 1 FROM post_review_actions pra WHERE pra.post_id = p.id AND pra.reviewer_id = ? AND pra.round = p.review_round)",
        params: [userId, userId],
      }
    : {
        where: "p.review_status = ? AND p.user_id != ? AND NOT EXISTS (SELECT 1 FROM post_review_actions pra WHERE pra.post_id = p.id AND pra.reviewer_id = ? AND pra.round = p.review_round)",
        params: ['pending', userId, userId],
      };
}

// ─── 巡查队列 ───
moderation.get('/review-posts', requireAdmin, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const db = c.env.DB;
  const queue = c.req.query('queue') === 'flagged' ? 'flagged' : 'pending';
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '10')));
  const offset = (page - 1) * pageSize;

  const dbUser: { role: string } | undefined = c.get('dbUser');
  const isAdmin = dbUser?.role === 'admin';
  const { where, params } = queueVisibility(user.userId, isAdmin, queue);
  const bindBase = [...params];

  const rows = await db.prepare(`
    SELECT p.id, p.title, p.content, p.price, p.category_id, p.is_anonymous, p.created_at,
           p.review_status, p.flagged_by, p.flagged_reason, p.violation_count,
           (SELECT COUNT(*) FROM post_review_actions pra WHERE pra.post_id = p.id AND pra.round = p.review_round AND pra.action = 'pass') AS pass_count,
           (SELECT COUNT(*) FROM post_review_actions pra WHERE pra.post_id = p.id AND pra.round = p.review_round AND pra.action IN ('violation','confirm')) AS violation_count,
           -- AI 判定参考（该帖最新一条 AI 审核日志）：approved = AI 判定无问题，供巡查员参考，不改变人工流程
           (SELECT action FROM ai_review_logs WHERE post_id = p.id ORDER BY id DESC LIMIT 1) AS ai_action,
           (SELECT verdict FROM ai_review_logs WHERE post_id = p.id ORDER BY id DESC LIMIT 1) AS ai_verdict,
           (SELECT confidence FROM ai_review_logs WHERE post_id = p.id ORDER BY id DESC LIMIT 1) AS ai_confidence,
           c.name AS category_name, c.allow_thanks,
           CASE WHEN p.is_anonymous = 1 THEN '匿名同学' ELSE u.username END AS username,
           CASE WHEN p.is_anonymous = 1 THEN '' ELSE u.avatar_url END AS avatar_url
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${where} AND p.deleted_at IS NULL
    ORDER BY p.created_at ASC
    LIMIT ? OFFSET ?
  `).bind(...bindBase, pageSize, offset).all<any>();

  const totalRow = await db.prepare(`
    SELECT COUNT(*) AS cnt FROM posts p
    WHERE ${where} AND p.deleted_at IS NULL
  `).bind(...bindBase).first<{ cnt: number }>();

  const pLimit = await passLimit(db);
  const vLimit = await violationLimit(db);
  // 付费帖在巡查队列里照常返回正文（审核需要读内容），price 一并返回，
  // 由前端巡查卡片在顶栏标注「付费帖 · 需 X 积分」；
  // 队列之外（帖子详情页）巡查员与普通用户一样要付费解锁（见 posts.ts 的付费门禁）
  return c.json({
    success: true,
    data: rows.results || [],
    total: totalRow?.cnt || 0,
    page,
    pageSize,
    queue,
    passLimit: pLimit,
    violationLimit: vLimit,
    adminVeto: isAdmin,
  });
});

// ─── 巡查动作 ───
// pending 队列：pass(没问题) / question(存疑) / violation(违规标记，第 1 票)
// flagged 队列：pass(没问题) / confirm(确认违规)——双计数竞争，先到阈值者生效，同时达标违规优先
// 本轮已投过票的巡查员不可重复操作（管理员豁免，一票生效）
moderation.post('/review-post', requireAdmin, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { post_id, action, reason } = await c.req.json();
  const postId = parseId(post_id);
  if (postId === null || !['pass', 'question', 'violation', 'confirm'].includes(action)) {
    return c.json({ success: false, error: '参数无效' }, 400);
  }
  const db = c.env.DB;

  const post = await db.prepare(`
    SELECT id, user_id, review_status, flagged_by, flagged_reason, violation_count, review_round
    FROM posts WHERE id = ? AND deleted_at IS NULL
  `).bind(postId).first<{ id: number; user_id: number; review_status: string; flagged_by: number | null; flagged_reason: string | null; violation_count: number; review_round: number }>();
  if (!post) return c.json({ success: false, error: '帖子不存在或已下架' }, 404);

  const dbUser: { role: string } | undefined = c.get('dbUser');
  const isAdmin = dbUser?.role === 'admin';
  const round = post.review_round || 0;

  // 状态机约束：pending 可投 pass/question/violation；questionable/violation 可投 pass/confirm；rejected/cleared 不可再操作
  if (post.review_status === 'rejected' || post.review_status === 'cleared') {
    return c.json({ success: false, error: '该帖已处理（打回或通过），不可再操作' }, 400);
  }
  if (post.review_status === 'pending' && action === 'confirm') {
    return c.json({ success: false, error: '待巡查帖子请投「没问题/存疑/有违规」' }, 400);
  }
  if (post.review_status !== 'pending' && (action === 'question' || action === 'violation')) {
    return c.json({ success: false, error: '待复核帖子请投「没问题/确认违规」' }, 400);
  }

  // 同轮重复操作：非管理员拒绝（投过票即隐藏，不应再操作）；管理员可覆盖（一票否决）
  if (!isAdmin) {
    const voted = await db.prepare('SELECT 1 FROM post_review_actions WHERE post_id = ? AND reviewer_id = ? AND round = ?')
      .bind(postId, user.userId, round).first();
    if (voted) {
      return c.json({ success: false, error: '你已对该帖子投过票，不能重复操作' }, 400);
    }
  }

  // 首次动作才结算巡查战绩（重复动作仅覆盖 action，不重复计经验/成就）
  const existing = await db.prepare('SELECT 1 FROM post_review_actions WHERE post_id = ? AND reviewer_id = ?')
    .bind(postId, user.userId).first();

  // 投票写入（幂等覆盖；管理员重复操作覆盖 action 不重复计票）
  await db.prepare(`INSERT INTO post_review_actions (post_id, reviewer_id, action, round) VALUES (?, ?, ?, ?)
    ON CONFLICT(post_id, reviewer_id) DO UPDATE SET action = excluded.action, round = excluded.round, created_at = datetime('now')`)
    .bind(postId, user.userId, action, round).run();

  // 双计数（当前轮次）：pass = 没问题票；violation+confirm = 违规票
  const countRow = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM post_review_actions WHERE post_id = ? AND round = ? AND action = 'pass') AS pass_cnt,
      (SELECT COUNT(*) FROM post_review_actions WHERE post_id = ? AND round = ? AND action IN ('violation','confirm')) AS viol_cnt
  `).bind(postId, round, postId, round).first<{ pass_cnt: number; viol_cnt: number }>();
  const passCnt = countRow?.pass_cnt || 0;
  const violCnt = countRow?.viol_cnt || 0;

  const stmts: any[] = [];
  let message = '';
  let takedown = false; // 本次动作是否触发打回（打回追加经验与计数）
  let recordAction = action; // 战绩结算动作：待复核队列 pass 放行 = 复核平反，按 clear 计入战绩

  if (isAdmin) {
    // 管理员：pass → 一票通过；violation/confirm → 一票否决（打回）；question → 与普通巡查员一致进入待复核（一票否决仅针对「通过/违规」两个判定）
    if (action === 'pass') {
      stmts.push(db.prepare("UPDATE posts SET review_status = 'cleared', flagged_by = NULL, flagged_reason = NULL, violation_count = 0 WHERE id = ? AND review_status IN ('pending','questionable','violation')").bind(postId));
      message = '管理员已确认：帖子通过巡查';
    } else if (action === 'question') {
      stmts.push(db.prepare("UPDATE posts SET review_status = 'questionable', flagged_by = ?, flagged_reason = ?, violation_count = 0 WHERE id = ?")
        .bind(user.userId, reason || '内容存疑', postId));
      message = '管理员已标记为存疑，进入待复核队列';
    } else {
      const r = await rejectPost(db, postId, post.user_id, reason || '管理员判定违规', await rejectCoins(db));
      if (!r.ok) return c.json({ success: false, error: '该帖已被并发处理，请刷新队列查看最新状态' }, 409);
      takedown = true;
      message = '管理员已否决：帖子打回重新编辑';
    }
  } else {
    const pLimit = await passLimit(db);
    const vLimit = await violationLimit(db);

    if (action === 'question') {
      // 存疑：进入待复核队列
      stmts.push(db.prepare("UPDATE posts SET review_status = 'questionable', flagged_by = ?, flagged_reason = ?, violation_count = 0 WHERE id = ?")
        .bind(user.userId, reason || '内容存疑', postId));
      message = '已标记为存疑，等待其他巡查员复核';
    } else if (action === 'violation') {
      // 违规第 1 票：进入待复核队列（violation 状态前台隐藏）
      stmts.push(db.prepare("UPDATE posts SET review_status = 'violation', flagged_by = ?, flagged_reason = ?, violation_count = 1 WHERE id = ?")
        .bind(user.userId, reason || '疑似违规', postId));
      message = `已标记违规（${violCnt}/${vLimit} 人），等待其他巡查员复核`;
    } else {
      // pass / confirm：双计数竞争——违规票优先，先到阈值者生效
      if (violCnt >= vLimit) {
        const r = await rejectPost(db, postId, post.user_id, post.flagged_reason || '违规确认', await rejectCoins(db));
        if (!r.ok) return c.json({ success: false, error: '该帖已被并发处理，请刷新队列查看最新状态' }, 409);
        takedown = true;
        message = `违规确认达 ${violCnt}/${vLimit} 人，帖子打回重新编辑`;
      } else if (passCnt >= pLimit) {
        stmts.push(db.prepare("UPDATE posts SET review_status = 'cleared', flagged_by = NULL, flagged_reason = NULL, violation_count = 0 WHERE id = ? AND review_status IN ('pending','questionable','violation')").bind(postId));
        // 待复核队列（questionable/violation）pass 达阈值放行 = 复核平反，按 clear 计入战绩（pending 队列 pass 仍按 pass）
        if (post.review_status !== 'pending') recordAction = 'clear';
        message = `「没问题」达 ${passCnt}/${pLimit} 人，帖子通过巡查`;
      } else {
        // 未达阈值：维持当前状态（violation 帖更新票数展示）
        if (post.review_status !== 'pending') {
          stmts.push(db.prepare("UPDATE posts SET violation_count = ? WHERE id = ?").bind(violCnt, postId));
        }
        message = action === 'confirm'
          ? `已确认违规（${violCnt}/${vLimit} 人），还需 ${vLimit - violCnt} 人确认`
          : `已投「没问题」（${passCnt}/${pLimit} 人），还需 ${pLimit - passCnt} 人`;
      }
    }
  }

  // 状态守卫：cleared/rejected 的状态 UPDATE 均带 review_status IN ('pending','questionable','violation')，
  // 防并发下后执行的 pass 分支覆盖先执行的违规分支（违规优先，同一请求内代码顺序已保证）
  if (stmts.length > 0) {
    const results = await db.batch(stmts);
    // batch 结果与语句同序，首条为状态 UPDATE：changes=0 说明状态已被并发处理改掉，本次不再生效
    const statusRes = results[0];
    if (statusRes && statusRes.meta.changes === 0) {
      return c.json({ success: false, error: '该帖已被并发处理，请刷新队列查看最新状态' }, 409);
    }
  }
  // 巡查战绩结算：仅首次动作结算（重复动作只覆盖 action）；recordPatrolAction 内部兜底，失败不影响主流程
  if (!existing) {
    await recordPatrolAction(db, user.userId, recordAction, takedown ? { takedown: true } : undefined);
  }
  return c.json({ success: true, message, pass_count: passCnt, violation_count: violCnt, adminVeto: isAdmin });
});

// 打回动作：先执行带状态守卫的状态 UPDATE（review_status IN ('pending','questionable','violation')），
// changes=0 说明状态已被并发分支改掉（如已 cleared），本次打回不生效且不执行扣分/通知（避免误扣分误通知）；
// 成功后再批量执行扣分 + 记流水 + 通知作者（1 天内修改重提，超时 cron 软删）
async function rejectPost(db: D1Database, postId: number, authorId: number, reason: string, coins: number): Promise<{ ok: boolean }> {
  const res = await db.prepare("UPDATE posts SET review_status = 'rejected', flagged_reason = ?, rejected_at = datetime('now'), violation_count = 0 WHERE id = ? AND review_status IN ('pending','questionable','violation')")
    .bind(reason, postId).run();
  if (!res.meta.changes) return { ok: false };
  await db.batch([
    db.prepare('UPDATE user_balances SET coins = MAX(0, coins - ?), total_spent = total_spent + ? WHERE user_id = ?')
      .bind(coins, coins, authorId),
    db.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'admin', ?, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(authorId, -coins, '帖子因违规被打回，扣减积分', authorId),
    // type=post_rejected：打回类通知（前端展开后提供「去修改」入口，作者编辑后重新提交）
    db.prepare("INSERT INTO notifications (user_id, type, post_id, content, read) VALUES (?, 'post_rejected', ?, ?, 0)")
      .bind(authorId, postId, `你的帖子被打回修改（${reason}），请在 1 天内修改后重新提交，否则将被删除`),
  ]);
  return { ok: true };
}

// ─── 巡查员战绩统计（巡查等级 + 累计计数 + 成就解锁状态） ───
// AI 审核日志：最近 20 条（aiReview.ts 消费端写入，表自动修剪；带出作者与帖子当前状态）
moderation.get('/ai-logs', requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT l.id, l.post_id, l.post_title, l.author_id, l.verdict, l.confidence,
           l.reasons, l.summary, l.action, l.error, l.created_at,
           u.username AS author_name,
           p.review_status AS current_status, p.deleted_at AS post_deleted
    FROM ai_review_logs l
    LEFT JOIN users u ON u.id = l.author_id
    LEFT JOIN posts p ON p.id = l.post_id
    ORDER BY l.id DESC
  `).all();
  return c.json({ success: true, data: rows.results || [] });
});

moderation.get('/stats', requireAdmin, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const db = c.env.DB;

  // 无战绩记录按全 0 处理（等级 1）
  const row = await db.prepare('SELECT * FROM user_patrol_stats WHERE user_id = ?')
    .bind(user.userId).first<PatrolStatsRow>();
  const { level, tierName, expInLevel, expNeededForLevel } = patrolLevelFromExp(row?.patrol_exp || 0);
  const achRows = await db.prepare("SELECT key FROM achievements WHERE user_id = ? AND key IN ('first_review','review_50','review_200','first_takedown','takedown_10','clear_10','pass_100','review_500','takedown_30','clear_50','pass_500')")
    .bind(user.userId).all<{ key: string }>();

  return c.json({
    success: true,
    data: {
      level,
      tierName,
      exp: row?.patrol_exp || 0,
      expInLevel,
      expNeededForLevel,
      totalReviews: row?.total_reviews || 0,
      totalPasses: row?.total_passes || 0,
      totalQuestions: row?.total_questions || 0,
      totalViolations: row?.total_violations || 0,
      totalConfirms: row?.total_confirms || 0,
      totalClears: row?.total_clears || 0,
      totalTakedowns: row?.total_takedowns || 0,
      todayCount: row?.today_count || 0,
      unlocked: (achRows.results || []).map(r => r.key),
    },
  });
});

export default moderation;
