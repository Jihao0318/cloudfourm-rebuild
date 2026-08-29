import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';

const coins = new Hono<{ Bindings: Env }>();

// 查询余额
coins.get('/balance', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const balance = await c.env.DB
    .prepare('SELECT coins, total_earned, total_spent FROM user_balances WHERE user_id = ?')
    .bind(user.userId)
    .first<{ coins: number; total_earned: number; total_spent: number }>();

  if (!balance) {
    // 初始化余额（初始积分后台可配 default_user_coins，默认 100）
    const setting = await c.env.DB
      .prepare("SELECT value FROM settings WHERE key = 'default_user_coins'")
      .first<{ value: string }>();
    const initialCoins = parseInt(setting?.value || '', 10);
    const startCoins = Number.isFinite(initialCoins) && initialCoins >= 0 ? initialCoins : 200;
    // 并发首次访问可能同时走到初始化：ON CONFLICT DO NOTHING 防主键冲突 500，之后重查实际余额
    await c.env.DB
      .prepare('INSERT INTO user_balances (user_id, coins, total_earned) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING')
      .bind(user.userId, startCoins, startCoins)
      .run();
    const fresh = await c.env.DB
      .prepare('SELECT coins, total_earned, total_spent FROM user_balances WHERE user_id = ?')
      .bind(user.userId)
      .first<{ coins: number; total_earned: number; total_spent: number }>();
    return c.json({ success: true, data: fresh || { coins: startCoins, total_earned: startCoins, total_spent: 0 } });
  }

  return c.json({ success: true, data: balance });
});

// ===== 今日收入明细 =====
coins.get('/today-earnings', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  // UTC+8 日期范围
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayDate = cst.toISOString().slice(0, 10);
  const startUtc = new Date(todayDate + 'T00:00:00Z');
  startUtc.setHours(startUtc.getHours() - 8);
  const endUtc = new Date(startUtc.getTime() + 86400000);
  const startStr = startUtc.toISOString().replace('T', ' ').slice(0, 19);
  const endStr = endUtc.toISOString().replace('T', ' ').slice(0, 19);

  // 仅统计日上限相关的活动收入类型
  const EARNING_TYPES = ['check_in', 'post', 'comment', 'liked'];
  const placeholders = EARNING_TYPES.map(() => '?').join(',');

  // 按 type 分组统计今日活动收入
  const rows = await c.env.DB
    .prepare(`SELECT type, SUM(amount) as total, COUNT(*) as cnt
      FROM coin_transactions
      WHERE user_id = ? AND amount > 0 AND type IN (${placeholders}) AND created_at >= ? AND created_at < ?
      GROUP BY type ORDER BY total DESC`)
    .bind(user.userId, ...EARNING_TYPES, startStr, endStr)
    .all<{ type: string; total: number; cnt: number }>();

  // 汇总今日活动总收入
  const totalRow = await c.env.DB
    .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM coin_transactions WHERE user_id = ? AND amount > 0 AND type IN (${placeholders}) AND created_at >= ? AND created_at < ?`)
    .bind(user.userId, ...EARNING_TYPES, startStr, endStr)
    .first<{ total: number }>();

  return c.json({
    success: true,
    data: {
      today_total: totalRow?.total || 0,
      daily_max: DAILY_MAX_COINS,
      details: (rows.results || []).map(r => ({ type: r.type, amount: r.total, count: r.cnt })),
    },
  });
});

// 交易记录（只读；流水收敛改由 scheduled 每日调用 cleanupTransactions 全表执行，不再挂在高频写路径上）
coins.get('/transactions', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const total = await c.env.DB
    .prepare('SELECT COUNT(*) as count FROM coin_transactions WHERE user_id = ?')
    .bind(user.userId)
    .first<{ count: number }>();

  const txs = await c.env.DB
    .prepare('SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(user.userId, pageSize, offset)
    .all();

  // 为转出/转入记录补充对方当前用户名
  const results = (txs.results || []).map((tx: any) => {
    if (tx.type === 'transfer_out' || tx.type === 'transfer_in') {
      const uidStr = tx.description?.match(/(?:to|from):(\d+)/)?.[1]
        || tx.description?.match(/(?:转给用户|来自用户)\s*(\d+)/)?.[1];
      if (uidStr) tx._related_uid = parseInt(uidStr);
    }
    return tx;
  });
  const uids = [...new Set(results.map((r: any) => r._related_uid).filter(Boolean))];
  if (uids.length > 0) {
    const placeholders = uids.map(() => '?').join(',');
    const userRows = await c.env.DB
      .prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`)
      .bind(...uids)
      .all<{ id: number; username: string }>();
    const nameMap = Object.fromEntries((userRows.results || []).map((u: any) => [u.id, u.username]));
    for (const tx of results) {
      if (tx._related_uid && nameMap[tx._related_uid]) {
        tx.other_username = nameMap[tx._related_uid];
      }
    }
  }

  return c.json({
    success: true,
    data: results,
    total: total?.count || 0,
    page,
    pageSize,
  });
});

// 转账（含手续费：50% 入主 admin 账户 transfer_fee，50% 销毁——通缩出口；无 admin 或分成额为 0 时全额销毁）
coins.post('/transfer', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { to_user_id, amount } = await c.req.json();

  // 金额必须是正整数：字符串（如 "1e2"）会绕过 < 1 检查并被拼进 SQL 运算，造成异常扣款/入账
  if (!to_user_id || typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) {
    return c.json({ success: false, error: '参数无效' }, 400);
  }
  if (to_user_id === user.userId) {
    return c.json({ success: false, error: '不能给自己转账' }, 400);
  }

  // 校验目标用户存在且未被软删除
  const targetUser = await c.env.DB
    .prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(to_user_id)
    .first<{ id: number }>();
  if (!targetUser) {
    return c.json({ success: false, error: '收款用户不存在' }, 404);
  }

  // 确保目标用户有 user_balances 记录
  await c.env.DB
    .prepare('INSERT INTO user_balances (user_id, coins, total_earned) VALUES (?, 0, 0) ON CONFLICT(user_id) DO NOTHING')
    .bind(to_user_id)
    .run();

  // 查询余额和 VIP 等级
  const [balance, vipInfo] = await Promise.all([
    c.env.DB.prepare('SELECT coins FROM user_balances WHERE user_id = ?').bind(user.userId).first<{ coins: number }>(),
    c.env.DB.prepare("SELECT tier FROM user_vips WHERE user_id = ? AND expires_at > datetime('now')").bind(user.userId).first<{ tier: string }>(),
  ]);

  if (!balance || balance.coins < amount) {
    return c.json({ success: false, error: '积分不足' }, 400);
  }

  // 计算手续费（手续费额外加，不从转账金额扣）
  const feeRates: Record<string, number> = { vip: 10, 's-vip': 5, 'svip+': 2 };
  const feeRate = (vipInfo && feeRates[vipInfo.tier] !== undefined) ? feeRates[vipInfo.tier] : 15;
  const fee = Math.ceil(amount * feeRate / 100);
  const totalDeduct = amount + fee;

  // ===== 手续费 50/50 分成 =====
  // admin 份额 = floor(fee/2)，入主 admin 账户（type='transfer_fee'；主 admin 取未软删 admin 中 id 最小者）；
  // 无 admin 或 adminShare=0 时跳过入账（全额销毁），有分成时实际销毁 = fee - adminShare
  const adminShare = Math.floor(fee / 2);
  const admin = adminShare > 0
    ? await c.env.DB
        .prepare("SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY id ASC LIMIT 1")
        .first<{ id: number }>()
    : null;
  // 主 admin 可能尚无余额行：与收款人同样先兜底建行（ON CONFLICT DO NOTHING），保证 batch 里的分成 UPDATE 必命中
  if (admin) {
    await c.env.DB
      .prepare('INSERT INTO user_balances (user_id, coins, total_earned) VALUES (?, 0, 0) ON CONFLICT(user_id) DO NOTHING')
      .bind(admin.id)
      .run();
  }
  // fee_burn 流水恒记全额手续费（-fee），不因 admin 分成扣减——分成单独记 transfer_fee 正流水，
  // 全局净额口径 = fee_burn(-fee) + transfer_fee(+adminShare) = -(fee - adminShare)，才与真实销毁额一致
  const burnAmount = fee;

  // 扣款先单独执行并检查 changes：若放在 batch 里，扣款 UPDATE 未命中（余额不足）时
  // batch 其余语句（收款人入账 + 流水）仍会执行——发送方没扣钱、收款方却到账，可无限铸币
  // 记账口径：transfer_out 记净额 -amount、fee_burn 单列 -fee，两笔合计 -(amount+fee) 与扣款一致（避免双重记账）
  const deductResult = await c.env.DB
    .prepare('UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ? WHERE user_id = ? AND coins >= ?')
    .bind(totalDeduct, totalDeduct, user.userId, totalDeduct)
    .run();
  if (!deductResult.meta.changes) {
    return c.json({ success: false, error: '积分不足' }, 400);
  }

  // 扣款成功后才执行入账 + 流水（同一 batch 原子提交）
  // 记账不变式：付款人两行流水 transfer_out(-amount) + fee_burn(-fee) 合计 = -(amount+fee) = 实际扣款额（避免双重记账）
  const batchStmts: D1PreparedStatement[] = [
    c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?').bind(amount, amount, to_user_id),
    // transfer_out 记净额 -amount；balance_after 经 SELECT coins 复用扣款后余额（等价 UPDATE...RETURNING）
    c.env.DB.prepare('INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, ?, ?, coins, ? FROM user_balances WHERE user_id = ?').bind(user.userId, 'transfer_out', -amount, `to:${to_user_id}|fee:${fee}`, user.userId),
    c.env.DB.prepare('INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, ?, ?, coins, ? FROM user_balances WHERE user_id = ?').bind(to_user_id, 'transfer_in', amount, `from:${user.userId}`, to_user_id),
    // 销毁记录（记在转账人头上，用于审计；恒记全额 -fee，有 admin 分成时真实销毁 = fee - adminShare，另见 admin 侧 transfer_fee 正流水）
    c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'fee_burn', ?, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(user.userId, -burnAmount, `手续费销毁 #${user.userId} → #${to_user_id}`, user.userId),
  ];

  // admin 份额入账（floor(fee/2)）：分成 UPDATE 与 transfer_fee 流水与收款人入账同一 batch 原子提交，
  // 流水 balance_after 经 SELECT coins 复用入账后余额；无 admin 或 adminShare=0 时一条不推，手续费全额销毁（全局净额 = -fee）
  if (admin) {
    batchStmts.push(
      c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?').bind(adminShare, adminShare, admin.id),
      c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'transfer_fee', ?, coins, ? FROM user_balances WHERE user_id = ?")
        .bind(admin.id, adminShare, `转账手续费分成 #${user.userId} → #${to_user_id}`, admin.id),
    );
  }

  await c.env.DB.batch(batchStmts);

  // 流水收敛不再挂在此写路径：改由 scheduled 每日调用 cleanupTransactions(db) 全表按用户收敛
  return c.json({ success: true, message: `转账成功！转出 ${totalDeduct} 积分（含手续费 ${fee}）` });
});

// 各品类每日次数上限（含品类限额 + 总积分上限）
// coins_per 必须与实际发放一致：comment 实际 +3（comments.ts）、liked 实际 +2（likes.ts）
// check_in 实际发放 = 阶梯基础奖励(最高 20) + VIP 加成(最高 5)，取上限 25 计入总量检查
const DAILY_LIMITS: Record<string, { max_times: number; coins_per: number }> = {
  post: { max_times: 2, coins_per: 10 },
  comment: { max_times: 5, coins_per: 3 },
  liked: { max_times: 5, coins_per: 2 },
  check_in: { max_times: 1, coins_per: 25 },
};
const DAILY_MAX_COINS = 50;

// 检查今日是否还能获得该品类奖励（品类限额 + 总积分上限）
export async function canEarnToday(db: D1Database, userId: number, type: string): Promise<boolean> {
  const limit = DAILY_LIMITS[type];
  if (!limit) return false;

  // 将 UTC+8 业务日期转换为 UTC 时间范围
  // 例如：UTC+8 日期 '2024-01-16' → UTC 范围 ['2024-01-15 16:00:00', '2024-01-16 16:00:00')
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayDate = cst.toISOString().slice(0, 10); // UTC+8 日期
  // UTC+8 0:00 对应的 UTC 时间 = UTC+8 日期 0:00 - 8h
  const startUtc = new Date(todayDate + 'T00:00:00Z');
  startUtc.setHours(startUtc.getHours() - 8);
  const endUtc = new Date(startUtc.getTime() + 86400000); // +24h
  const startStr = startUtc.toISOString().replace('T', ' ').slice(0, 19);
  const endStr = endUtc.toISOString().replace('T', ' ').slice(0, 19);

  // 合并统计：品类次数 + 今日总收入（一条 SQL，用 UTC 时间范围）
  // 退款类流水（红包取消/解封退回）是返还用户自己的钱，不计入"今日可赚取"上限
  const stats = await db
    .prepare(`SELECT 
      COUNT(CASE WHEN type = ? THEN 1 END) as cnt,
      COALESCE(SUM(CASE WHEN amount > 0 AND type NOT IN ('red_packet_refund', 'unban_refund') THEN amount ELSE 0 END), 0) as total
      FROM coin_transactions WHERE user_id = ? AND created_at >= ? AND created_at < ?`)
    .bind(type, userId, startStr, endStr)
    .first<{ cnt: number; total: number }>();
  if ((stats?.cnt || 0) >= limit.max_times) return false;
  if ((stats?.total || 0) + limit.coins_per > DAILY_MAX_COINS) return false;

  return true;
}

// 获得积分的每日上限检查（向后兼容）
export async function checkDailyLimit(db: D1Database, userId: number, type: 'post' | 'comment' | 'liked'): Promise<boolean> {
  return canEarnToday(db, userId, type);
}

// 增加积分（由其他 handler 调用）
export async function addCoins(db: D1Database, userId: number, type: string, amount: number, description: string): Promise<void> {
  await db.batch([
    db.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?').bind(amount, amount, userId),
    db.prepare('INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, ?, ?, coins, ? FROM user_balances WHERE user_id = ?').bind(userId, type, amount, description, userId),
  ]);
  // 流水收敛已移出高频写路径（原 cleanupTransactions 内 5% 概率全表清理在此被触发，已移除）：
  // 改由 scheduled 每日调用 cleanupTransactions(db) 全表按用户收敛（保留最近 15 条 + 当日记录）
}

// 清理旧交易记录：每个用户只保留最近 15 条（1 页），当日记录不删（当日限额 COUNT/SUM 依赖）
// 由 scheduled 每日调用（不带 userId → 全表按用户收敛，ROW_NUMBER 窗口函数），
// 不再挂在高频写路径上概率触发（原 addCoins 路径内 5% 概率全表清理已移除）。
// 带 userId 的按用户收敛保留给 shop.ts / check-in.ts 等既有写路径确定性调用
// （低成本：走 user_id 索引、只处理该用户历史行）；coins.ts 内 addCoins/transfer 的调用已移除
export async function cleanupTransactions(db: D1Database, userId?: number): Promise<void> {
  // 今日 UTC+8 窗口起点（与 canEarnToday / utils/game.ts todayWindowUtc8 口径一致）
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayDate = cst.toISOString().slice(0, 10);
  const startUtc = new Date(todayDate + 'T00:00:00Z');
  startUtc.setHours(startUtc.getHours() - 8);
  const todayStart = startUtc.toISOString().replace('T', ' ').slice(0, 19);

  if (userId !== undefined) {
    // 清理当前用户：今天 UTC 窗口内的行一律不删（当日限额 COUNT/SUM 依赖它们，删了可反复刷奖励），
    // 只删今天之前的历史行，且历史行仍保留最近 15 条
    await db.prepare(`
      DELETE FROM coin_transactions WHERE user_id = ? AND created_at < ? AND id NOT IN (
        SELECT id FROM coin_transactions WHERE user_id = ? AND created_at < ?
        ORDER BY created_at DESC LIMIT 15
      )
    `).bind(userId, todayStart, userId, todayStart).run();
    return;
  }

  // 全表按用户收敛（scheduled 每日调用）：兜底回收、抽奖、商城等所有入口，同样只清历史行。
  // 内部 SQL 与原 5% 概率清理一字未改，仅去掉 Math.random 概率触发
  await db.prepare(`
    DELETE FROM coin_transactions WHERE created_at < ? AND id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
        FROM coin_transactions WHERE created_at < ?
      ) WHERE rn <= 15
    )
  `).bind(todayStart, todayStart).run().catch(() => {});
}

export default coins;
