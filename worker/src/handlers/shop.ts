import { Hono } from 'hono';
import type { Env, JWTPayload, ShopItem, UserItem } from '../types';
import { requireAuth } from '../middleware/auth';
import { parseId } from '../utils/validation';
import { addCoins, cleanupTransactions } from './coins';
import { createToken } from '../utils/jwt';

const shop = new Hono<{ Bindings: Env }>();

// 双表商品 id 空间隔离：shop_extras 的 id 统一 +10000 偏移（如 shop_extras id=1 → 对外 id=10001），
// 避免与 shop_items 的 id 冲突导致前端 key 重复、买错商品；buy/:id 时按偏移还原回查
const EXTRA_ID_OFFSET = 10000;

// 单次购买数量上限（前端滑块上限同值，后端兜底校验，防止绕过前端提交超大数量）
const MAX_BUY_QUANTITY = 10;

// 获取商品列表
shop.get('/items', async (c) => {
  const [old, extra] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM shop_items WHERE is_active = 1 ORDER BY sort_order ASC, id ASC').all<any>(),
    c.env.DB.prepare('SELECT * FROM shop_extras WHERE is_active = 1 ORDER BY sort_order ASC, id ASC').all<any>(),
  ]);
  const extras = (extra.results || []).map((e: any) => ({ ...e, id: e.id + EXTRA_ID_OFFSET, src: 'extra' }));
  return c.json({ success: true, data: [...(old.results || []), ...extras] });
});

// 购买商品
shop.post('/buy/:id', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const itemId = parseId(c.req.param('id'));
  if (itemId === null) return c.json({ success: false, error: '无效的商品ID' }, 400);

  // 查询商品信息（id > 偏移 → shop_extras，减偏移后查库；否则 shop_items）
  // 双表均校验 is_active = 1：下架商品不可购买
  let item = null;
  if (itemId > EXTRA_ID_OFFSET) {
    item = await c.env.DB
      .prepare("SELECT *, 'extra' as src FROM shop_extras WHERE id = ? AND is_active = 1")
      .bind(itemId - EXTRA_ID_OFFSET)
      .first<any>();
  } else {
    item = await c.env.DB
      .prepare("SELECT *, 'shop' as src FROM shop_items WHERE id = ? AND is_active = 1")
      .bind(itemId)
      .first<any>();
  }
  if (!item) {
    // 区分「不存在」与「已下架」
    const exists = itemId > EXTRA_ID_OFFSET
      ? await c.env.DB.prepare('SELECT id FROM shop_extras WHERE id = ?').bind(itemId - EXTRA_ID_OFFSET).first()
      : await c.env.DB.prepare('SELECT id FROM shop_items WHERE id = ?').bind(itemId).first();
    if (exists) return c.json({ success: false, error: '商品已下架' }, 400);
    return c.json({ success: false, error: '商品不存在' }, 404);
  }
  // 返回时把 extra 商品的 id 恢复为对外偏移值，前端可据此关联
  if (item.src === 'extra') item.id = item.id + EXTRA_ID_OFFSET;

  // 购买数量：缺省/非法值按 1 件；超过上限直接拒绝（滑块上限由前端给，这里兜底）
  let quantity = 1;
  try {
    const body = await c.req.json();
    const raw = parseInt(body?.quantity);
    if (Number.isInteger(raw) && raw > 0) quantity = raw;
  } catch { /* 无请求体：按 1 件 */ }
  if (quantity > MAX_BUY_QUANTITY) {
    return c.json({ success: false, error: `单次最多购买 ${MAX_BUY_QUANTITY} 件` }, 400);
  }
  const totalPrice = item.price * quantity;

  // 查余额
  const balance = await c.env.DB
    .prepare('SELECT coins FROM user_balances WHERE user_id = ?')
    .bind(user.userId)
    .first<{ coins: number }>();
  if (!balance || balance.coins < totalPrice) {
    return c.json({ success: false, error: `积分不足，需要 ${totalPrice} 积分` }, 400);
  }

  // 原子扣款 + 发放物品（总价 = 单价 × 数量，一次扣款、一次批量发放）
  const deductResult = await c.env.DB
    .prepare('UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ? WHERE user_id = ? AND coins >= ?')
    .bind(totalPrice, totalPrice, user.userId, totalPrice)
    .run();

  if (!deductResult.meta.changes) {
    return c.json({ success: false, error: '积分不足' }, 400);
  }

  const stmts: any[] = [
    c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'shop', ?, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(user.userId, -totalPrice, `购买「${item.name}」${quantity > 1 ? ` ×${quantity}` : ''}`, user.userId),
  ];

  if (item.src === 'extra') {
    // 商城卡进 user_lottery_items：把商品 data 里的 duration_days 带进 item_meta，
    // 供 use/avatar-frame、use/custom-title 等端点按卡面时长生效（默认值由各端点兜底）
    let meta: string | null = null;
    try {
      const d = JSON.parse(item.data || '{}');
      if (d.duration_days) meta = JSON.stringify({ duration_days: d.duration_days });
    } catch { /* data 非法则按默认时长 */ }
    const stmt = c.env.DB.prepare(meta
      ? 'INSERT INTO user_lottery_items (user_id, item_type, item_name, item_meta) VALUES (?, ?, ?, ?)'
      : 'INSERT INTO user_lottery_items (user_id, item_type, item_name) VALUES (?, ?, ?)');
    for (let i = 0; i < quantity; i++) {
      stmts.push(stmt.bind(...(meta ? [user.userId, item.type, item.name, meta] : [user.userId, item.type, item.name])));
    }
  } else {
    const stmt = c.env.DB.prepare('INSERT INTO user_items (user_id, item_id) VALUES (?, ?)');
    for (let i = 0; i < quantity; i++) {
      stmts.push(stmt.bind(user.userId, itemId));
    }
  }

  await c.env.DB.batch(stmts);
  // 写入新流水后立即收敛：每用户只保留最近 15 条
  await cleanupTransactions(c.env.DB, user.userId);

  return c.json({
    success: true,
    data: { item, quantity, total_price: totalPrice },
    message: `成功购买「${item.name}」${quantity > 1 ? ` ×${quantity}` : ''}`,
  });
});

// 使用改名卡
shop.post('/use-rename', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { new_username } = await c.req.json();

  if (!new_username || new_username.length < 3 || new_username.length > 20) {
    return c.json({ success: false, error: '用户名长度应为 3-20 个字符' }, 400);
  }
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(new_username)) {
    return c.json({ success: false, error: '用户名只能包含字母、数字、下划线和中文' }, 400);
  }

  // 检查改名卡
  const renameCard = await c.env.DB
    .prepare('SELECT ui.id FROM user_items ui JOIN shop_items si ON ui.item_id = si.id WHERE ui.user_id = ? AND si.type = ? AND ui.used = 0 ORDER BY ui.id ASC LIMIT 1')
    .bind(user.userId, 'rename_card')
    .first<{ id: number }>();
  if (!renameCard) return c.json({ success: false, error: '没有可用的改名卡' }, 400);

  // 检查用户名是否被占用
  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE username = ? AND id != ? AND deleted_at IS NULL')
    .bind(new_username, user.userId)
    .first();
  if (existing) return c.json({ success: false, error: '该用户名已被使用' }, 409);

  // 标记改名卡已使用 + 更新用户名
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE user_items SET used = 1 WHERE id = ?').bind(renameCard.id),
    c.env.DB.prepare("UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?").bind(new_username, user.userId),
  ]);

  // 签发新 JWT（用户名变了，旧 token 已失效；ver 用 DB 最新 token_version，不从旧 payload 复制）
  const verRow = await c.env.DB.prepare('SELECT token_version FROM users WHERE id = ?').bind(user.userId).first<{ token_version: number }>();
  const newToken = await createToken(
    { userId: user.userId, username: new_username, ver: verRow?.token_version ?? 0 },
    c.env.JWT_SECRET
  );

  return c.json({ success: true, message: `用户名已修改为「${new_username}」`, token: newToken });
});

// 获取用户已拥有的物品
shop.get('/my-items', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const items = await c.env.DB
    .prepare(`
      SELECT ui.*, si.name, si.type, si.price, si.data
      FROM user_items ui
      JOIN shop_items si ON ui.item_id = si.id
      WHERE ui.user_id = ?
      ORDER BY ui.created_at DESC
    `)
    .bind(user.userId)
    .all();
  return c.json({ success: true, data: items.results });
});

export default shop;