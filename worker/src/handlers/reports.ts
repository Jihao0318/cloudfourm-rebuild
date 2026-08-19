import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';

const reports = new Hono<{ Bindings: Env }>();

// 提交举报（帖子或评论）
reports.post('/', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { target_type, target_id, reason } = await c.req.json();

  if (!target_id || !reason || reason.length < 2 || !['post', 'comment'].includes(target_type)) {
    return c.json({ success: false, error: '参数无效' }, 400);
  }
  if (reason.length > 500) {
    return c.json({ success: false, error: '举报原因不能超过 500 字' }, 400);
  }

  const table = target_type === 'post' ? 'posts' : 'comments';
  const target = await c.env.DB
    .prepare(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`)
    .bind(target_id)
    .first<{ id: number }>();
  if (!target) return c.json({ success: false, error: `${target_type === 'post' ? '帖子' : '评论'}不存在或已删除` }, 404);

  // 查询关联的帖子 ID（评论也需要关联到帖子以满足外键约束）
  let postId = 0;
  if (target_type === 'post') {
    postId = target_id;
  } else {
    const comment = await c.env.DB
      .prepare('SELECT post_id FROM comments WHERE id = ?')
      .bind(target_id)
      .first<{ post_id: number }>();
    postId = comment?.post_id || 0;
  }

  // 检查是否已举报过同一内容：任意状态（含已驳回）的记录都拒绝再次举报，
  // 防止被处理后同内容被无限重新举报刷屏（被驳回后需管理员处理或等待后续冷却机制）
  const dup = await c.env.DB
    .prepare('SELECT id FROM reports WHERE target_id = ? AND target_type = ? AND reporter_id = ?')
    .bind(target_id, target_type, user.userId)
    .first();
  if (dup) return c.json({ success: false, error: '你已经举报过此内容' }, 409);

  try {
    await c.env.DB
      .prepare('INSERT INTO reports (post_id, reporter_id, reason, target_type, target_id) VALUES (?, ?, ?, ?, ?)')
      .bind(postId, user.userId, reason, target_type, target_id)
      .run();

    return c.json({ success: true, message: '举报已提交，管理员将尽快审核' });
  } catch (err: any) {
    return c.json({ success: false, error: `举报失败: ${err.message}` }, 500);
  }
});

export default reports;
