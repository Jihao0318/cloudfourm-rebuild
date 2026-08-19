import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth, optionalAuth } from '../middleware/auth';

const follows = new Hono<{ Bindings: Env }>();

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw);
  return !isNaN(n) && n > 0 ? n : null;
}

// 关注/取消关注
follows.post('/:userId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const followingId = parseId(c.req.param('userId'));
  if (!followingId || followingId === user.userId) {
    return c.json({ success: false, error: '无效的用户' }, 400);
  }
  // 确认目标用户存在
  const target = await c.env.DB
    .prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(followingId).first();
  if (!target) return c.json({ success: false, error: '用户不存在' }, 404);

  // 原子切换：INSERT OR IGNORE + meta.changes 判定，避免先 SELECT 后写带来的并发撞主键 500
  const result = await c.env.DB
    .prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)')
    .bind(user.userId, followingId)
    .run();

  if (result.meta.changes > 0) {
    // 本次实际插入 → 新关注
    return c.json({ success: true, data: { following: true }, message: '已关注' });
  }
  // 已存在（changes=0）→ 取消关注
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?')
    .bind(user.userId, followingId).run();
  return c.json({ success: true, data: { following: false }, message: '已取消关注' });
});

// 检查是否已关注
follows.get('/check/:userId', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const targetId = parseId(c.req.param('userId'));
  if (!targetId || targetId === user.userId) return c.json({ success: true, data: { following: false } });
  const existing = await c.env.DB
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
    .bind(user.userId, targetId).first();
  return c.json({ success: true, data: { following: !!existing } });
});

// 获取关注列表
follows.get('/:userId/following', optionalAuth, async (c) => {
  const userId = parseId(c.req.param('userId'));
  if (!userId) return c.json({ success: true, data: [], total: 0 }, 400);
  // 非法 page 参数（NaN）回落默认 1，避免 Math.max(1, NaN)=NaN 传入 OFFSET 导致 500
  const rawPage = parseInt(c.req.query('page') || '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const [list, countResult] = await Promise.all([
    c.env.DB.prepare(`
      SELECT u.id, u.username, u.avatar_url, u.bio, f.created_at as followed_at
      FROM follows f JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = ? AND u.deleted_at IS NULL
      ORDER BY f.created_at DESC LIMIT ? OFFSET ?
    `).bind(userId, pageSize, offset).all(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?')
      .bind(userId).first<{ count: number }>(),
  ]);

  return c.json({ success: true, data: list.results, total: countResult?.count || 0, page, pageSize });
});

// 获取粉丝列表
follows.get('/:userId/followers', optionalAuth, async (c) => {
  const userId = parseId(c.req.param('userId'));
  if (!userId) return c.json({ success: true, data: [], total: 0 }, 400);
  // 非法 page 参数（NaN）回落默认 1，避免 Math.max(1, NaN)=NaN 传入 OFFSET 导致 500
  const rawPage = parseInt(c.req.query('page') || '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const [list, countResult] = await Promise.all([
    c.env.DB.prepare(`
      SELECT u.id, u.username, u.avatar_url, u.bio, f.created_at as followed_at
      FROM follows f JOIN users u ON f.follower_id = u.id
      WHERE f.following_id = ? AND u.deleted_at IS NULL
      ORDER BY f.created_at DESC LIMIT ? OFFSET ?
    `).bind(userId, pageSize, offset).all(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?')
      .bind(userId).first<{ count: number }>(),
  ]);

  return c.json({ success: true, data: list.results, total: countResult?.count || 0, page, pageSize });
});

// 获取关注数/粉丝数
follows.get('/counts/:userId', optionalAuth, async (c) => {
  const userId = parseId(c.req.param('userId'));
  if (!userId) return c.json({ success: true, data: { following: 0, followers: 0 } }, 400);
  const [following, followers] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?').bind(userId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?').bind(userId).first<{ count: number }>(),
  ]);
  return c.json({ success: true, data: { following: following?.count || 0, followers: followers?.count || 0 } });
});

export default follows;
