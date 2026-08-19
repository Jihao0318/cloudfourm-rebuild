import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';
import { createNotification } from '../db/queries';

const tips = new Hono<{ Bindings: Env }>();

const TIP_AMOUNTS = [5, 10, 50];
const TIP_DAILY_LIMIT = 200;       // 每日最多打赏支出 200 分
const TIP_DAILY_COUNT_LIMIT = 15;  // 每日最多打赏 15 次

// 打赏
tips.post('/', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { target_type, target_id, amount } = await c.req.json();

  if (!target_id || !target_type || !['post', 'comment'].includes(target_type)) {
    return c.json({ success: false, error: '参数无效' }, 400);
  }
  if (!amount || !TIP_AMOUNTS.includes(amount)) {
    return c.json({ success: false, error: `打赏金额必须为 ${TIP_AMOUNTS.join('/')} 积分` }, 400);
  }

  // 查询内容作者
  const author = target_type === 'post'
    ? await c.env.DB.prepare('SELECT user_id FROM posts WHERE id = ? AND deleted_at IS NULL').bind(target_id).first<{ user_id: number }>()
    : await c.env.DB.prepare('SELECT user_id FROM comments WHERE id = ? AND deleted_at IS NULL').bind(target_id).first<{ user_id: number }>();

  if (!author) return c.json({ success: false, error: `${target_type === 'post' ? '帖子' : '评论'}不存在或已删除` }, 404);
  if (author.user_id === user.userId) return c.json({ success: false, error: '不能给自己打赏' }, 400);

  // 每日打赏次数/总额限制（按 UTC 日统计，打赏记录表 created_at 存 UTC）
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString().replace('T', ' ').slice(0, 19);

  const todayTips = await c.env.DB
    .prepare("SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt FROM tips WHERE from_user_id = ? AND created_at >= ?")
    .bind(user.userId, todayStr)
    .first<{ total: number; cnt: number }>();

  if ((todayTips?.cnt || 0) >= TIP_DAILY_COUNT_LIMIT) {
    return c.json({ success: false, error: `今日打赏次数已达上限(${TIP_DAILY_COUNT_LIMIT}次)` }, 400);
  }
  if ((todayTips?.total || 0) + amount > TIP_DAILY_LIMIT) {
    return c.json({ success: false, error: `今日打赏总额已达上限，剩余可用 ${Math.max(0, TIP_DAILY_LIMIT - (todayTips?.total || 0))} 分` }, 400);
  }

  // 余额检查 + 扣款
  const balance = await c.env.DB
    .prepare('SELECT coins FROM user_balances WHERE user_id = ?')
    .bind(user.userId)
    .first<{ coins: number }>();
  if (!balance || balance.coins < amount) {
    return c.json({ success: false, error: `积分不足，需要 ${amount} 积分` }, 400);
  }

  // 余额 + 当日限额原子扣款：预检（上方 SELECT）只做友好提示，真正的限额判定并入
  // 本 UPDATE 的条件子查询（次数 < 15 且 总额 + amount <= 200），由单条语句原子判定，
  // 避免并发请求在 SELECT 与扣款之间同时通过预检、突破 15 次/200 分上限
  const deductResult = await c.env.DB
    .prepare(`
      UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ?
      WHERE user_id = ? AND coins >= ?
        AND (SELECT COUNT(*) FROM tips WHERE from_user_id = ? AND created_at >= ?) < ?
        AND (SELECT COALESCE(SUM(amount), 0) FROM tips WHERE from_user_id = ? AND created_at >= ?) + ? <= ?
    `)
    .bind(amount, amount, user.userId, amount,
      user.userId, todayStr, TIP_DAILY_COUNT_LIMIT,
      user.userId, todayStr, amount, TIP_DAILY_LIMIT)
    .run();

  if (!deductResult.meta.changes) {
    // 预检通过但原子扣款未命中：并发下要么余额被抢先用尽，要么同时触达当日限额
    return c.json({ success: false, error: '积分不足或已达今日打赏限额' }, 400);
  }

  // 加作者积分 + 记录打赏 + 交易记录
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?')
      .bind(amount, amount, author.user_id),
    c.env.DB.prepare('INSERT INTO tips (from_user_id, to_user_id, target_type, target_id, amount) VALUES (?, ?, ?, ?, ?)')
      .bind(user.userId, author.user_id, target_type, target_id, amount),
    // 打赏者交易记录
    c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'tip_out', ?, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(user.userId, -amount, `打赏 ${target_type === 'post' ? '帖子' : '评论'} #${target_id}|to:${author.user_id}`, user.userId),
    // 作者交易记录
    c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'tip_in', ?, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(author.user_id, amount, `收到打赏 from:${user.userId}`, author.user_id),
  ]);

  // 发送通知
  const targetLabel = target_type === 'post' ? '帖子' : '评论';
  await createNotification(c.env.DB, author.user_id, user.userId, 'system', target_type === 'post' ? target_id : undefined, undefined, `打赏了你的 ${targetLabel} ${amount} 积分`);

  return c.json({ success: true, message: `打赏成功！送出 ${amount} 积分` });
});

export default tips;