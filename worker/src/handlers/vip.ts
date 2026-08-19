import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';
import { cleanupTransactions } from './coins';

const vip = new Hono<{ Bindings: Env }>();

// VIP 等级配置
// 注意：check_in_bonus / transfer_fee 必须与真实实现一致（check-in.ts 签到加成 vip:2/s-vip:3/svip+:5；
// coins.ts 转账费率 vip:10%/s-vip:5%/svip+:2%），仅 /vip/plans 展示用，购买扣款以 price 为准
const VIP_TIERS: Record<string, { label: string; price: number; upload_limit: number; check_in_bonus: number; transfer_fee: number }> = {
  vip:     { label: 'VIP',     price: 300,  upload_limit: 20, check_in_bonus: 2,  transfer_fee: 10 },
  's-vip': { label: 'S VIP',  price: 800,  upload_limit: 30, check_in_bonus: 3,  transfer_fee: 5 },
  'svip+':  { label: 'S VIP+', price: 2800, upload_limit: 50, check_in_bonus: 5, transfer_fee: 2 },
};

// 查询 VIP 状态
vip.get('/status', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const vipInfo = await c.env.DB
    .prepare('SELECT * FROM user_vips WHERE user_id = ?')
    .bind(user.userId)
    .first<{ tier: string; started_at: string; expires_at: string; auto_renew: number }>();

  if (!vipInfo || vipInfo.tier === 'none') {
    return c.json({ success: true, data: { is_vip: false, tier: 'none' } });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const isExpired = vipInfo.expires_at <= now;

  return c.json({
    success: true,
    data: {
      is_vip: !isExpired,
      tier: vipInfo.tier,
      label: VIP_TIERS[vipInfo.tier]?.label || vipInfo.tier,
      started_at: vipInfo.started_at,
      expires_at: vipInfo.expires_at,
      auto_renew: !!vipInfo.auto_renew,
      expired: isExpired,
    },
  });
});

// 购买/续费 VIP
vip.post('/purchase', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { tier } = await c.req.json();

  if (!tier || !VIP_TIERS[tier]) {
    return c.json({ success: false, error: '无效的会员等级' }, 400);
  }

  // 查询余额和现有 VIP
  const [balance, existing] = await Promise.all([
    c.env.DB.prepare('SELECT coins FROM user_balances WHERE user_id = ?').bind(user.userId).first<{ coins: number }>(),
    c.env.DB.prepare('SELECT tier, expires_at FROM user_vips WHERE user_id = ?').bind(user.userId).first<{ tier: string; expires_at: string }>(),
  ]);

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // 检查是否已拥有更高级别
  const tierOrder = ['none', 'vip', 's-vip', 'svip+'];
  const currentIdx = tierOrder.indexOf(existing?.tier || 'none');
  const targetIdx = tierOrder.indexOf(tier);
  if (existing && targetIdx <= currentIdx && existing.expires_at > now) {
    return c.json({ success: false, error: '你已拥有相同或更高级别的会员' }, 400);
  }

  // 升级计价：已持有未过期低等级 VIP 时只需补差价
  const isVipValid = existing && existing.expires_at > now;
  const cfg = VIP_TIERS[tier];
  const isUpgrade = isVipValid && targetIdx > currentIdx;
  const currentTierPrice = isVipValid ? (VIP_TIERS[tierOrder[currentIdx]]?.price || 0) : 0;
  const actualPrice = isUpgrade ? cfg.price - currentTierPrice : cfg.price;

  if (!balance || balance.coins < actualPrice) {
    return c.json({ success: false, error: `积分不足，需要 ${actualPrice} 积分` }, 400);
  }

  // 计算到期时间（不同等级天数）
  const daysMap: Record<string, number> = { vip: 30, 's-vip': 90, 'svip+': 365 };
  const days = daysMap[tier] || 30;

  let newExpires: string;
  if (existing && existing.expires_at > now) {
    const baseDate = new Date(existing.expires_at.replace(' ', 'T') + 'Z');
    baseDate.setDate(baseDate.getDate() + days);
    newExpires = baseDate.toISOString().replace('T', ' ').slice(0, 19);
  } else {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + days);
    newExpires = baseDate.toISOString().replace('T', ' ').slice(0, 19);
  }

  // 原子扣款：用 WHERE coins >= ? 保证并发安全，防止余额变负数
  const deductResult = await c.env.DB
    .prepare('UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ? WHERE user_id = ? AND coins >= ?')
    .bind(actualPrice, actualPrice, user.userId, actualPrice)
    .run();

  if (!deductResult.meta.changes) {
    return c.json({ success: false, error: `积分不足，需要 ${actualPrice} 积分` }, 400);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO user_vips (user_id, tier, started_at, expires_at, auto_renew)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(user_id) DO UPDATE SET tier = ?, started_at = ?, expires_at = ?, auto_renew = 0
    `).bind(user.userId, tier, now, newExpires, tier, now, newExpires),
    c.env.DB.prepare('INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, ?, ?, coins, ? FROM user_balances WHERE user_id = ?')
      .bind(user.userId, 'purchase', -actualPrice, `购买 ${VIP_TIERS[tier].label}${isUpgrade ? `（升级补差价 ${actualPrice}）` : ''}`, user.userId),
  ]);

  // 写入新流水后立即收敛：每用户只保留最近 15 条
  await cleanupTransactions(c.env.DB, user.userId);

  return c.json({ success: true, message: `已成功购买 ${VIP_TIERS[tier].label}，到期 ${newExpires.slice(0, 10)}` });
});

// 查询 VIP 配置（前端展示用）
vip.get('/plans', async (c) => {
  const plans = Object.entries(VIP_TIERS).map(([tier, cfg]) => ({
    tier,
    label: cfg.label,
    price: cfg.price,
    upload_limit: cfg.upload_limit,
    check_in_bonus: cfg.check_in_bonus,
    transfer_fee: cfg.transfer_fee,
  }));
  return c.json({ success: true, data: plans });
});

// 续费查询（取当前 VIP 可升级的等级）
vip.get('/upgrade-info', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const vipInfo = await c.env.DB
    .prepare('SELECT tier FROM user_vips WHERE user_id = ?')
    .bind(user.userId)
    .first<{ tier: string }>();

  const currentTier = vipInfo?.tier || 'none';
  const tierOrder = ['none', 'vip', 's-vip', 'svip+'];
  const currentIdx = tierOrder.indexOf(currentTier);

  const upgradeOptions = Object.entries(VIP_TIERS)
    .filter(([tier]) => tierOrder.indexOf(tier) >= currentIdx)
    .map(([tier, cfg]) => ({ tier, label: cfg.label, price: cfg.price }));

  return c.json({ success: true, data: { current_tier: currentTier, upgrade_options: upgradeOptions } });
});

export default vip;
export { VIP_TIERS };
