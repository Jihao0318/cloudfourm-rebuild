import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';

const notifications = new Hono<{ Bindings: Env }>();

// 获取通知列表
notifications.get('/', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const [list, countResult, unreadResult] = await Promise.all([
    c.env.DB.prepare(`
      SELECT n.*, u.username as actor_name, u.avatar_url as actor_avatar
      FROM notifications n
      LEFT JOIN users u ON n.actor_id = u.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(user.userId, pageSize, offset).all(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ?').bind(user.userId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0').bind(user.userId).first<{ count: number }>(),
  ]);

  return c.json({
    success: true,
    data: list.results,
    total: countResult?.count || 0,
    unread: unreadResult?.count || 0,
    page,
    pageSize,
  });
});

// 标记单条已读
notifications.put('/:id/read', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ success: false, error: '参数无效' }, 400);
  await c.env.DB
    .prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
    .bind(id, user.userId)
    .run();
  return c.json({ success: true });
});

// 标记全部已读
notifications.put('/read-all', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  await c.env.DB
    .prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0")
    .bind(user.userId)
    .run();
  return c.json({ success: true });
});

// 清理已送达的通知（客户端已存本地后调用，释放 DB 空间）
// 前端会传 maxId（本次已拉取的最大通知 id）：只删除 id <= maxId 的通知，
// 避免「拉取与删除窗口内」新到达的通知被清空丢失；不传时保持旧行为（清空全部，向后兼容）
notifications.delete('/delivered', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const maxIdRaw = c.req.query('maxId');
  if (maxIdRaw !== undefined && maxIdRaw !== '') {
    const maxId = parseInt(maxIdRaw);
    if (!Number.isFinite(maxId)) return c.json({ success: false, error: '参数无效' }, 400);
    await c.env.DB
      .prepare('DELETE FROM notifications WHERE user_id = ? AND id <= ?')
      .bind(user.userId, maxId)
      .run();
  } else {
    await c.env.DB
      .prepare('DELETE FROM notifications WHERE user_id = ?')
      .bind(user.userId)
      .run();
  }
  return c.json({ success: true, message: '已清理' });
});

// 获取未读数
notifications.get('/unread-count', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const result = await c.env.DB
    .prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0')
    .bind(user.userId)
    .first<{ count: number }>();
  return c.json({ success: true, data: { unread: result?.count || 0 } });
});

export default notifications;
