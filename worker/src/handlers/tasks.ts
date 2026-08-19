import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';
import { todayUtc8, todayWindowUtc8, addExp } from '../utils/game';

const tasks = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 每日任务定义（引擎二）
// checkin：签到奖励由 check-in.ts 本身发放，任务仅展示完成态（0 积分 0 经验）
const TASK_DEFS = [
  { task_type: 'checkin', label: '每日签到', coins: 0, exp: 0, goal: 1 },
  { task_type: 'post', label: '发布帖子', coins: 8, exp: 15, goal: 1 },
  { task_type: 'comment', label: '发表评论', coins: 4, exp: 10, goal: 2 },
  { task_type: 'liked', label: '获得点赞', coins: 4, exp: 10, goal: 1 },
];

// 当日行为计数
async function todayCounts(db: D1Database, userId: number): Promise<Record<string, number>> {
  const { start, end } = todayWindowUtc8();
  const [post, comment, liked, checkin] = await Promise.all([
    // 软删内容不计入每日任务
    db.prepare('SELECT COUNT(*) as cnt FROM posts WHERE user_id = ? AND created_at >= ? AND created_at < ? AND deleted_at IS NULL')
      .bind(userId, start, end).first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM comments WHERE user_id = ? AND created_at >= ? AND created_at < ? AND deleted_at IS NULL')
      .bind(userId, start, end).first<{ cnt: number }>(),
    // 软删内容的被赞数不计入每日任务
    db.prepare(`SELECT COUNT(*) as cnt FROM likes WHERE created_at >= ? AND created_at < ?
      AND ((target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE user_id = ? AND deleted_at IS NULL))
        OR (target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE user_id = ? AND deleted_at IS NULL)))`)
      .bind(start, end, userId, userId).first<{ cnt: number }>(),
    // check_ins.check_in_date 为 UTC+8 业务日（YYYY-MM-DD），与 todayUtc8() 口径一致
    db.prepare('SELECT COUNT(*) as cnt FROM check_ins WHERE user_id = ? AND check_in_date = ?')
      .bind(userId, todayUtc8()).first<{ cnt: number }>(),
  ]);
  return { checkin: checkin?.cnt || 0, post: post?.cnt || 0, comment: comment?.cnt || 0, liked: liked?.cnt || 0 };
}

// 今日任务状态
tasks.get('/today', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const db = c.env.DB;

  const [counts, taskRows] = await Promise.all([
    todayCounts(db, user.userId),
    db.prepare('SELECT task_type, done, claimed FROM daily_tasks WHERE user_id = ? AND date = ?')
      .bind(user.userId, todayUtc8()).all<{ task_type: string; done: number; claimed: number }>(),
  ]);
  const rowMap = new Map((taskRows.results || []).map(r => [r.task_type, r]));

  const list = TASK_DEFS.map(t => {
    const row = rowMap.get(t.task_type);
    const count = counts[t.task_type];
    return {
      task_type: t.task_type,
      label: t.label,
      // done 一律以实时计数为准（发帖后删帖/取消赞等行为回滚后任务自然回退，不残留）
      done: count >= t.goal,
      claimed: !!(row?.claimed),
      coins: t.coins,
      exp: t.exp,
      goal: t.goal,
      progress: Math.min(count, t.goal),
    };
  });

  return c.json({
    success: true,
    data: {
      tasks: list,
      all_done: list.every(t => t.done),
      bonus_claimed: rowMap.has('bonus'), // bonus 行只在领取时插入（claimed=1）
    },
  });
});

// 领取已完成任务奖励
tasks.post('/claim', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { task_type } = await c.req.json();
  const def = TASK_DEFS.find(t => t.task_type === task_type);
  if (!def) return c.json({ success: false, error: '参数无效' }, 400);

  const db = c.env.DB;
  const today = todayUtc8();
  // 完成判定以实时计数为准（粘性 done 标志不可信：发帖后删帖、取消赞等行为回滚后不得领取）
  const counts = await todayCounts(db, user.userId);
  if ((counts[task_type] || 0) < def.goal) {
    return c.json({ success: false, error: '任务未完成' }, 400);
  }
  // 原子置位：无行时 INSERT（changes=1 正常领取）；有行且 claimed=0 时 UPDATE（changes=1）；
  // 已领取时 WHERE claimed=0 不命中（changes=0 拒绝）——并发重复领取安全
  const mark = await db.prepare(`INSERT INTO daily_tasks (user_id, date, task_type, done, claimed) VALUES (?, ?, ?, 1, 1)
    ON CONFLICT(user_id, date, task_type) DO UPDATE SET done = 1, claimed = 1 WHERE daily_tasks.claimed = 0`)
    .bind(user.userId, today, task_type).run();
  if (!mark.meta.changes) {
    return c.json({ success: false, error: '任务奖励已领取' }, 400);
  }

  const stmts: any[] = [];
  // 0 奖励任务（checkin：签到奖励由签到接口发放）不发积分/不产生流水
  if (def.coins > 0) {
    stmts.push(
      db.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?')
        .bind(def.coins, def.coins, user.userId),
      db.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'task_reward', ?, coins, ? FROM user_balances WHERE user_id = ?")
        .bind(user.userId, def.coins, `每日任务：${def.label}`, user.userId),
    );
  }
  await db.batch(stmts);

  if (def.exp > 0) await addExp(db, user.userId, def.exp);

  return c.json({ success: true, data: { coins: def.coins, exp: def.exp } });
});

// 每日任务全勤宝箱（4 个任务全部完成，含签到——与 /today 的 all_done 口径一致）
tasks.post('/claim-bonus', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const db = c.env.DB;
  const today = todayUtc8();

  // 与 /today 的 done 判定一致：全部按实时计数
  const counts = await todayCounts(db, user.userId);
  if (!TASK_DEFS.every(t => (counts[t.task_type] || 0) >= t.goal)) {
    return c.json({ success: false, error: '尚未完成全部每日任务' }, 400);
  }

  const ins = await db.prepare("INSERT OR IGNORE INTO daily_tasks (user_id, date, task_type, done, claimed) VALUES (?, ?, 'bonus', 1, 1)")
    .bind(user.userId, today).run();
  if (!ins.meta.changes) {
    return c.json({ success: false, error: '宝箱已领取' }, 400);
  }

  await db.batch([
    db.prepare('UPDATE user_balances SET coins = coins + 14, total_earned = total_earned + 14 WHERE user_id = ?')
      .bind(user.userId),
    db.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'task_bonus', 14, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(user.userId, '每日任务全勤宝箱', user.userId),
  ]);

  return c.json({ success: true, data: { coins: 14 } });
});

export default tasks;
