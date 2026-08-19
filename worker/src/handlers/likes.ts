import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { createLike, deleteLike, createNotification } from '../db/queries';
import { requireAuth } from '../middleware/auth';
import { canEarnToday, addCoins } from './coins';
import { todayWindowUtc8, addExp, markTaskDone, unlockAchievement } from '../utils/game';

const likes = new Hono<{ Bindings: Env }>();

// 给内容作者加积分（被点赞奖励）+ 经验/任务/成就钩子（失败不影响点赞主流程）
// author 由 handler 一次查出，通知与奖励共用，避免重复 D1 往返
async function rewardAuthor(db: D1Database, author: { user_id: number } | null, likerId: number): Promise<void> {
  if (!author || author.user_id === likerId) return; // 不给自己的内容点赞奖励

  if (await canEarnToday(db, author.user_id, 'liked')) {
    await addCoins(db, author.user_id, 'liked', 2, '内容被点赞');
  }

  // 引擎一/二/三：被赞 +1 经验、标记"获得点赞"任务、人气王成就
  await addExp(db, author.user_id, 1);
  await markTaskDone(db, author.user_id, 'liked');
  // 软删内容的被赞数不计入人气王成就统计
  const total = await db.prepare(`SELECT COUNT(*) as cnt FROM likes
      WHERE (target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE user_id = ? AND deleted_at IS NULL))
         OR (target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE user_id = ? AND deleted_at IS NULL))`)
    .bind(author.user_id, author.user_id).first<{ cnt: number }>();
  if ((total?.cnt || 0) >= 100) {
    await unlockAchievement(db, author.user_id, 'likes_100');
  }
}

// 点赞（INSERT OR IGNORE 自动去重，无需预查）
likes.post('/', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { target_id, target_type } = await c.req.json();

  if (!target_id || !target_type || !['post', 'comment'].includes(target_type)) {
    return c.json({ success: false, error: '参数无效' }, 400);
  }

  // 日限 20 次（UTC+8 日窗）
  const { start, end } = todayWindowUtc8();
  const cnt = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM likes WHERE user_id = ? AND created_at >= ? AND created_at < ?')
    .bind(user.userId, start, end).first<{ cnt: number }>();
  if ((cnt?.cnt || 0) >= 20) {
    return c.json({ success: false, error: '今日点赞次数已达上限' }, 400);
  }

  // 预查是否已赞（INSERT OR IGNORE 幂等；钩子只在"新增赞"时触发，防重复刷经验）
  const existing = await c.env.DB.prepare('SELECT id FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?')
    .bind(user.userId, target_id, target_type).first();

  await createLike(c.env.DB, user.userId, target_id, target_type);

  // 作者一次查询，通知与奖励共用，避免重复 D1 往返（软删内容不再触发点赞通知/奖励）
  const author = target_type === 'post'
    ? await c.env.DB.prepare('SELECT user_id FROM posts WHERE id = ? AND deleted_at IS NULL').bind(target_id).first<{ user_id: number }>()
    : await c.env.DB.prepare('SELECT user_id FROM comments WHERE id = ? AND deleted_at IS NULL').bind(target_id).first<{ user_id: number }>();
  if (author) {
    createNotification(c.env.DB, author.user_id, user.userId, target_type === 'post' ? 'like_post' : 'like_comment', target_type === 'post' ? target_id : undefined);
  }

  // 给内容作者加积分/经验/任务/成就（仅新增赞；异步非阻塞，失败不影响点赞主流程）
  if (!existing) {
    await rewardAuthor(c.env.DB, author, user.userId).catch((e) => { console.error('like reward hook failed', e); });
  }

  return c.json({ success: true, message: '点赞成功' });
});

// 取消点赞（DELETE 不报错，无需预查）
likes.delete('/', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { target_id, target_type } = await c.req.json();

  if (!target_id || !target_type || !['post', 'comment'].includes(target_type)) {
    return c.json({ success: false, error: '参数无效' }, 400);
  }

  await deleteLike(c.env.DB, user.userId, target_id, target_type);
  return c.json({ success: true, message: '已取消点赞' });
});

export default likes;
