import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';
import { parseId } from '../utils/validation';
import { levelFromExp, unlockLevelFor } from '../utils/game';

const decorations = new Hono<{ Bindings: Env }>();

// 获取用户已拥有的装饰 (card + title)
decorations.get('/my', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const items = await c.env.DB
    .prepare(`
      SELECT ui.id as user_item_id, ui.used, ui.applied_to,
             si.id as item_id, si.name, si.price, si.data
      FROM user_items ui
      JOIN shop_items si ON ui.item_id = si.id
      WHERE ui.user_id = ? AND si.type = 'post_decoration' AND ui.used = 0
      ORDER BY ui.created_at DESC
    `)
    .bind(user.userId)
    .all();
  return c.json({ success: true, data: items.results });
});

// 判断装饰是否为标题装饰 (根据 data 中的 css_class)
function isTitleDecoration(data: string): boolean {
  try {
    const d = JSON.parse(data);
    return d.css_class === 'decoration-title-gold';
  } catch { return false; }
}

// 给帖子应用装饰
decorations.post('/apply/:postId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const postId = parseId(c.req.param('postId'));
  if (postId === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);

  const { user_item_id } = await c.req.json();
  if (!user_item_id) return c.json({ success: false, error: '请选择装饰' }, 400);

  // 校验帖子所有权
  const post = await c.env.DB
    .prepare('SELECT user_id FROM posts WHERE id = ? AND deleted_at IS NULL')
    .bind(postId)
    .first<{ user_id: number }>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能装饰自己的帖子' }, 403);

  // 校验装饰所有权 + 获取 data 判断类型
  const item = await c.env.DB
    .prepare(`
      SELECT ui.id, ui.used, si.type, si.data FROM user_items ui
      JOIN shop_items si ON ui.item_id = si.id
      WHERE ui.id = ? AND ui.user_id = ? AND si.type = 'post_decoration' AND ui.used = 0
    `)
    .bind(user_item_id, user.userId)
    .first<{ id: number; used: number; type: string; data: string }>();
  if (!item) return c.json({ success: false, error: '装饰不存在或已使用' }, 400);

  const isTitle = isTitleDecoration(item.data);

  // 等级解锁门槛：鎏金标题装饰需 Lv.24（LEVEL_TIERS 鎏金标题解锁等级）
  if (isTitle) {
    const unlockLevel = unlockLevelFor('gold_title') || 0;
    const dbUser = await c.env.DB.prepare('SELECT exp FROM users WHERE id = ?').bind(user.userId).first<{ exp: number }>();
    if (levelFromExp(dbUser?.exp || 0).level < unlockLevel) {
      return c.json({ success: false, error: `等级不足：需 Lv.${unlockLevel} 才能使用鎏金标题` }, 400);
    }
  }

  // 应用装饰: 标题装饰→title_decoration_id, 卡片装饰→decoration_id
  if (isTitle) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE user_items SET used = 1, applied_to = ? WHERE id = ?')
        .bind(postId, user_item_id),
      c.env.DB.prepare('UPDATE posts SET title_decoration_id = (SELECT item_id FROM user_items WHERE id = ?) WHERE id = ?')
        .bind(user_item_id, postId),
    ]);
  } else {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE user_items SET used = 1, applied_to = ? WHERE id = ?')
        .bind(postId, user_item_id),
      c.env.DB.prepare('UPDATE posts SET decoration_id = (SELECT item_id FROM user_items WHERE id = ?) WHERE id = ?')
        .bind(user_item_id, postId),
    ]);
  }

  return c.json({ success: true, message: '装饰已应用' });
});

// 移除帖子装饰 (清除两种装饰)
decorations.post('/remove/:postId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const postId = parseId(c.req.param('postId'));
  if (postId === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);

  const post = await c.env.DB
    .prepare('SELECT user_id FROM posts WHERE id = ? AND deleted_at IS NULL')
    .bind(postId)
    .first<{ user_id: number }>();
  if (!post) return c.json({ success: false, error: '帖子不存在' }, 404);
  if (post.user_id !== user.userId) return c.json({ success: false, error: '只能操作自己的帖子' }, 403);

  // 清除所有装饰 (card + title)：不删除道具行，而是恢复为未使用（文案承诺"可重新使用"）。
  // 必须限定 item_id 为 post_decoration 类：applied_to 与推荐卡等道具共用，
  // 原 DELETE 会误删挂在同一帖子上的推荐卡等非装饰道具
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE posts SET decoration_id = NULL, title_decoration_id = NULL WHERE id = ?').bind(postId),
    c.env.DB.prepare(`
      UPDATE user_items SET used = 0, applied_to = NULL
      WHERE applied_to = ? AND user_id = ?
        AND item_id IN (SELECT id FROM shop_items WHERE type = 'post_decoration')
    `).bind(postId, user.userId),
  ]);

  return c.json({ success: true, message: '装饰已移除（可重新使用）' });
});

export default decorations;