import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';
import { todayWindowUtc8, addExp, unlockAchievement } from '../utils/game';

const thanks = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 感谢（免费，每日限 5 次；单向不可撤销）
thanks.post('/', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { target_type, target_id } = await c.req.json();
  if (!target_id || !['post', 'comment'].includes(target_type)) {
    return c.json({ success: false, error: '参数无效' }, 400);
  }
  const db = c.env.DB;

  // a. 目标存在校验 + 板块感谢开关校验（只有启用了感谢的板块才可使用感谢功能）
  const table = target_type === 'post' ? 'posts' : 'comments';
  const target = await db.prepare(
    target_type === 'post'
      ? `SELECT p.user_id, c.allow_thanks FROM posts p JOIN categories c ON p.category_id = c.id WHERE p.id = ? AND p.deleted_at IS NULL`
      : `SELECT c.user_id, cat.allow_thanks FROM comments c JOIN posts p ON c.post_id = p.id JOIN categories cat ON p.category_id = cat.id WHERE c.id = ? AND c.deleted_at IS NULL`
  ).bind(target_id).first<{ user_id: number; allow_thanks: number }>();
  if (!target) {
    return c.json({ success: false, error: `${target_type === 'post' ? '帖子' : '评论'}不存在或已删除` }, 404);
  }
  // 板块未启用感谢 → 拒绝（成就「热心肠」也因此只在启用板块的感谢中可达成）
  if (!target.allow_thanks) {
    return c.json({ success: false, error: '该板块未启用感谢功能' }, 400);
  }

  // b. 不能感谢自己
  if (target.user_id === user.userId) {
    return c.json({ success: false, error: '不能感谢自己的内容' }, 400);
  }

  // c. 日限 5 次
  const { start, end } = todayWindowUtc8();
  const cnt = await db.prepare('SELECT COUNT(*) as cnt FROM thanks WHERE user_id = ? AND created_at >= ? AND created_at < ?')
    .bind(user.userId, start, end).first<{ cnt: number }>();
  if ((cnt?.cnt || 0) >= 5) {
    return c.json({ success: false, error: '今日感谢次数已用完' }, 400);
  }

  // d. 幂等插入（冗余 target_user_id：目标被硬删除后感谢仍计入作者成就）
  const ins = await db.prepare('INSERT OR IGNORE INTO thanks (user_id, target_type, target_id, target_user_id) VALUES (?, ?, ?, ?)')
    .bind(user.userId, target_type, target_id, target.user_id).run();
  if (!ins.meta.changes) {
    return c.json({ success: false, error: '已经感谢过这条内容了' }, 400);
  }

  // e. 感谢计数 +1
  await db.prepare(`UPDATE ${table} SET thanks_count = thanks_count + 1 WHERE id = ?`).bind(target_id).run();

  // f. 被感谢者 +5 经验；成就「热心肠」（感谢总数 >= 50）
  const targetUserId = target.user_id;
  await addExp(db, targetUserId, 5).catch(() => {});
  // 计数走冗余列 target_user_id（无需反查 posts/comments，硬删除内容上的感谢不丢）
  const total = await db.prepare('SELECT COUNT(*) as cnt FROM thanks t WHERE t.target_user_id = ?')
    .bind(targetUserId).first<{ cnt: number }>();
  if ((total?.cnt || 0) >= 50) {
    await unlockAchievement(db, targetUserId, 'thanks_50').catch((e) => { console.error('thanks achievement hook failed', e); });
  }

  return c.json({ success: true, message: '感谢已送出' });
});

export default thanks;
