import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';
import { parseId } from '../utils/validation';

const bookmarks = new Hono<{ Bindings: Env }>();

// 收藏/取消收藏
bookmarks.post('/toggle', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { post_id } = await c.req.json();
  if (!post_id) return c.json({ success: false, error: '缺少 post_id' }, 400);

  // 检查是否已收藏
  const existing = await c.env.DB
    .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND post_id = ?')
    .bind(user.userId, post_id)
    .first<{ id: number }>();

  if (existing) {
    await c.env.DB.prepare('DELETE FROM bookmarks WHERE id = ?').bind(existing.id).run();
    return c.json({ success: true, data: { bookmarked: false }, message: '已取消收藏' });
  } else {
    await c.env.DB
      .prepare('INSERT OR IGNORE INTO bookmarks (user_id, post_id) VALUES (?, ?)')
      .bind(user.userId, post_id)
      .run();
    return c.json({ success: true, data: { bookmarked: true }, message: '已收藏' });
  }
});

// 检查是否已收藏
bookmarks.get('/check/:postId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  // 用 parseId 严格解析：parseInt 会把 NaN 原样绑进 SQL，须先拒绝非法 ID
  const postId = parseId(c.req.param('postId'));
  if (postId === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);
  const existing = await c.env.DB
    .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND post_id = ?')
    .bind(user.userId, postId)
    .first<{ id: number }>();
  return c.json({ success: true, data: { bookmarked: !!existing } });
});

// 获取收藏列表
bookmarks.get('/', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const [list, countResult] = await Promise.all([
    c.env.DB.prepare(`
      SELECT b.id as bookmark_id, b.created_at as bookmarked_at,
             p.id,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE p.user_id END AS user_id,
             p.is_anonymous, p.title, p.content, p.category_id, p.is_pinned, p.is_locked,
             p.view_count, p.like_count, p.comment_count, p.thanks_count, p.post_bg_id,
             p.created_at, p.updated_at, p.deleted_at, p.decoration_id, p.title_decoration_id,
             p.highlighted_until, p.fortune, p.title_effect, p.title_effect_expires_at,
             p.is_essence, p.bumped_until, p.fortune_expires_at, p.price,
             CASE WHEN p.is_anonymous = 1 THEN '匿名同学' ELSE u.username END AS username,
             CASE WHEN p.is_anonymous = 1 THEN NULL ELSE u.avatar_url END AS author_avatar
      FROM bookmarks b
      JOIN posts p ON b.post_id = p.id AND p.deleted_at IS NULL
      LEFT JOIN users u ON p.user_id = u.id
      WHERE b.user_id = ? AND p.review_status NOT IN ('violation', 'rejected')
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(user.userId, pageSize, offset).all(),
    c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM bookmarks b
      JOIN posts p ON b.post_id = p.id AND p.deleted_at IS NULL
      WHERE b.user_id = ? AND p.review_status NOT IN ('violation', 'rejected')
    `).bind(user.userId).first<{ count: number }>(),
  ]);

  // 付费帖子：对列表隐藏实际内容，替换为锁定标记（与 posts 列表口径一致，防未付费看全文）
  const safeList = (list.results || []).map((p: any) => {
    if (p.price) {
      const content = '__PAID__' + p.price;
      return { ...p, content };
    }
    return p;
  });

  return c.json({
    success: true,
    data: safeList,
    total: countResult?.count || 0,
    page,
    pageSize,
  });
});

export default bookmarks;
