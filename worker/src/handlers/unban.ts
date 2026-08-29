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
  // 扣款 UPDATE 携带全部前置条件（余额充足 + 无待审核申请），单条语句原子判定（闸门），
  // 兼作「已有 pending 申请」的快速路径——有待审申请时不扣款、不插入；
  // 后续 INSERT OR IGNORE 通过上一语句的 changes() 判断扣款是否命中。pending 冲突的
  // 权威裁定由部分唯一索引 idx_unban_pending_user（074 迁移）+ OR IGNORE 兜底：
  // 撞索引时静默跳过（changes=0 → 409），无需应用层重复预查。
  // status 无需显式写入：012 迁移定义 status TEXT NOT NULL DEFAULT 'pending'，
  // 默认值即为 'pending'，部分唯一索引对本插入生效。
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ?
      WHERE user_id = ? AND coins >= ?
        AND NOT EXISTS (SELECT 1 FROM unban_requests WHERE user_id = ? AND status = 'pending')
    `).bind(UNBAN_PRICE, UNBAN_PRICE, user.userId, UNBAN_PRICE, user.userId),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO unban_requests (user_id, coins_paid)
      SELECT ?, ?
      WHERE (SELECT changes()) = 1
    `).bind(user.userId, UNBAN_PRICE),
    // 交易记录：仅当申请插入成功才记录（balance_after 取扣款后余额）
    c.env.DB.prepare(`
      INSERT INTO coin_transactions (user_id, type, amount, balance_after, description)
      SELECT ?, 'unban_deposit', ?, coins, ?
      FROM user_balances WHERE user_id = ? AND (SELECT changes()) = 1
    `).bind(user.userId, -UNBAN_PRICE, '解封保证金（审核通过不退，审核失败全额退款）', user.userId),
  ]);

  const insertChanged = (results[1]?.meta.changes ?? 0) > 0;
  if (!insertChanged) {
    // changes === 0 的两种可能：① 扣款闸门未命中（余额不足，或已有待审申请故未扣款）；
    // ② 扣款命中但 INSERT OR IGNORE 撞上 idx_unban_pending_user（并发双提交的兜底裁定，
    //    保证每人至多一条 pending 申请）。下方查询区分两种情况，分别返回 409 / 400。
    const pending = await c.env.DB
      .prepare("SELECT id FROM unban_requests WHERE user_id = ? AND status = 'pending'")
      .bind(user.userId)
      .first();
    if (pending) return c.json({ success: false, error: '已有待处理的解封申请' }, 409);
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