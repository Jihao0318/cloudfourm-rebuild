import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';
import { cleanupTransactions } from './coins';

/**
 * 限时兑换商店：管理员配置限时上架的道具，用户用积分兑换。
 *
 * - 发放链路与商城一致：写入 user_lottery_items（item_type 对应 shop_extras.type，
 *   duration_days 写入 item_meta），仓库/使用/回收的既有逻辑全部复用
 * - 回收价自动 = 对应商城价 × 30%（items.ts 回收端点按 item_type 查 shop_extras ✓）
 * - 限购与库存：per_user_limit（0 = 不限）、stock（-1 = 不限量）
 * - 兑换为纯消耗：积分只扣不退（使用/过期由道具自身规则决定）
 */
const exchange = new Hono<{ Bindings: Env }>();

exchange.use('*', requireAuth);

// ─── 用户：在售列表（含剩余库存 / 我的已兑数量）───
exchange.get('/offers', async (c) => {
  const user: JWTPayload = c.get('user');
  const rows = await c.env.DB.prepare(`
    SELECT o.id, o.name, o.description, o.item_type, o.duration_days, o.price,
           o.stock, o.per_user_limit, o.ends_at,
           (SELECT COUNT(*) FROM user_lottery_items li
             WHERE li.item_type = o.item_type
               AND json_extract(li.item_meta, '$.exchange_id') = o.id
               AND li.user_id = ?) AS my_count
    FROM exchange_offers o
    WHERE o.is_active = 1 AND (o.ends_at IS NULL OR o.ends_at > datetime('now'))
      AND (o.stock < 0 OR o.stock > 0)
    ORDER BY o.created_at DESC
  `).bind(user.userId).all<any>();
  return c.json({ success: true, data: rows.results || [] });
});

// ─── 用户：兑换 ───
exchange.post('/buy/:id', async (c) => {
  const user: JWTPayload = c.get('user');
  const id = parseInt(c.req.param('id'));
  if (!id) return c.json({ success: false, error: '无效的兑换项' }, 400);

  const offer = await c.env.DB
    .prepare(`SELECT * FROM exchange_offers WHERE id = ? AND is_active = 1`)
    .bind(id)
    .first<any>();
  if (!offer) return c.json({ success: false, error: '兑换项不存在或已下架' }, 404);
  if (offer.ends_at && offer.ends_at <= new Date().toISOString().replace('T', ' ').slice(0, 19)) {
    return c.json({ success: false, error: '该兑换已截止' }, 400);
  }

  // 每人限购（按发放记录数；0 = 不限）
  if (offer.per_user_limit > 0) {
    const mine = await c.env.DB
      .prepare(`SELECT COUNT(*) AS c FROM user_lottery_items
        WHERE user_id = ? AND item_type = ? AND json_extract(item_meta, '$.exchange_id') = ?`)
      .bind(user.userId, offer.item_type, offer.id)
      .first<{ c: number }>();
    if ((mine?.c || 0) >= offer.per_user_limit) {
      return c.json({ success: false, error: `已达每人限购（${offer.per_user_limit} 件）` }, 400);
    }
  }

  // 余额预检
  const bal = await c.env.DB.prepare('SELECT coins FROM user_balances WHERE user_id = ?')
    .bind(user.userId).first<{ coins: number }>();
  if (!bal || bal.coins < offer.price) {
    return c.json({ success: false, error: `积分不足，需要 ${offer.price} 积分` }, 400);
  }

  // 扣款（CAS：余额不足自动失败）+ 库存扣减（限量商品）+ 发放 + 流水，同一 batch 原子提交
  const meta = JSON.stringify({
    duration_days: offer.duration_days || undefined,
    exchange_id: offer.id,
  });
  const stmts: any[] = [
    c.env.DB.prepare('UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ? WHERE user_id = ? AND coins >= ?')
      .bind(offer.price, offer.price, user.userId, offer.price),
    c.env.DB.prepare(`INSERT INTO user_lottery_items (user_id, item_type, item_name, item_meta) VALUES (?, ?, ?, ?)`)
      .bind(user.userId, offer.item_type, offer.name, meta),
    c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'exchange', ?, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(user.userId, -offer.price, `兑换「${offer.name}」`, user.userId),
  ];
  if (offer.stock >= 0) {
    stmts.push(c.env.DB.prepare('UPDATE exchange_offers SET stock = stock - 1 WHERE id = ? AND stock > 0').bind(offer.id));
  }
  await c.env.DB.batch(stmts);

  await cleanupTransactions(c.env.DB, user.userId).catch(() => {});
  return c.json({ success: true, message: `兑换成功：「${offer.name}」已放入仓库` });
});

export default exchange;
