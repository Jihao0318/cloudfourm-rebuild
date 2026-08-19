import { Hono } from 'hono';
import type { Env, JWTPayload, UnbanRequest, User } from '../types';
import { requireAuth } from '../middleware/auth';

const UNBAN_PRICE = 500;

const unban = new Hono<{ Bindings: Env }>();

// 提交自赎申请
unban.post('/request', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');

  // 封禁期校验：仅当前处于封禁期（banned_until 非空且在未来）的用户可提交自赎申请
  const dbUser = c.get('dbUser') as User;
  if (!dbUser?.banned_until) {
    return c.json({ success: false, error: '当前不在封禁期' }, 400);
  }
  const bannedUntil = new Date(dbUser.banned_until.replace(' ', 'T') + 'Z').getTime();
  if (bannedUntil <= Date.now()) {
    return c.json({ success: false, error: '当前不在封禁期' }, 400);
  }

  // 驳回后 3 天冷却：最近一次驳回时间距今不足 3 天则拒绝再次申请
  const lastRejected = await c.env.DB
    .prepare("SELECT reviewed_at FROM unban_requests WHERE user_id = ? AND status = 'rejected' ORDER BY reviewed_at DESC LIMIT 1")
    .bind(user.userId)
    .first<{ reviewed_at: string | null }>();
  if (lastRejected?.reviewed_at) {
    const rejectedAt = new Date(lastRejected.reviewed_at.replace(' ', 'T') + 'Z').getTime();
    const cooldownMs = 3 * 24 * 3600 * 1000;
    const remaining = cooldownMs - (Date.now() - rejectedAt);
    if (remaining > 0) {
      const hours = Math.ceil(remaining / 3600000);
      return c.json({ success: false, error: `申请被驳回后 3 天内不能再次提交，还需等待约 ${hours} 小时` }, 400);
    }
  }

  // 原子提交：条件扣款 + 条件插入申请 + 交易流水，全部在同一事务（batch）内完成，
  // 杜绝并发双提交/双扣款/双申请。
  // 扣款 UPDATE 携带全部前置条件（余额充足 + 无待审核申请），单条语句原子判定（闸门）；
  // 后续 INSERT 通过上一语句的 changes() 判断扣款是否命中——仅当扣款成功且仍无待审核申请才插入申请。
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ?
      WHERE user_id = ? AND coins >= ?
        AND NOT EXISTS (SELECT 1 FROM unban_requests WHERE user_id = ? AND status = 'pending')
    `).bind(UNBAN_PRICE, UNBAN_PRICE, user.userId, UNBAN_PRICE, user.userId),
    c.env.DB.prepare(`
      INSERT INTO unban_requests (user_id, coins_paid)
      SELECT ?, ?
      WHERE (SELECT changes()) = 1
        AND NOT EXISTS (SELECT 1 FROM unban_requests WHERE user_id = ? AND status = 'pending')
    `).bind(user.userId, UNBAN_PRICE, user.userId),
    // 交易记录：仅当申请插入成功才记录（balance_after 取扣款后余额）
    c.env.DB.prepare(`
      INSERT INTO coin_transactions (user_id, type, amount, balance_after, description)
      SELECT ?, 'unban_deposit', ?, coins, ?
      FROM user_balances WHERE user_id = ? AND (SELECT changes()) = 1
    `).bind(user.userId, -UNBAN_PRICE, '解封保证金（审核通过不退，审核失败全额退款）', user.userId),
  ]);

  const insertChanged = (results[1]?.meta.changes ?? 0) > 0;
  if (!insertChanged) {
    // 原子判定未通过：并发下要么已有待审核申请，要么余额不足（预检与扣款之间被并发消费）
    const pending = await c.env.DB
      .prepare("SELECT id FROM unban_requests WHERE user_id = ? AND status = 'pending'")
      .bind(user.userId)
      .first();
    if (pending) return c.json({ success: false, error: '已有待审核的申请，请耐心等待' }, 409);
    return c.json({ success: false, error: `积分不足，解封需要 ${UNBAN_PRICE} 积分` }, 400);
  }

  return c.json({
    success: true,
    message: `解封申请已提交，扣除 ${UNBAN_PRICE} 积分作为保证金，请等待管理员审核`,
  });
});

// 查看自己的申请
unban.get('/my-request', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const request = await c.env.DB
    .prepare('SELECT * FROM unban_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(user.userId)
    .first<UnbanRequest>();
  return c.json({ success: true, data: request || null });
});

export default unban;