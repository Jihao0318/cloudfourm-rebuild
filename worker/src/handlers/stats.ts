import { Hono } from 'hono';
import type { Env } from '../types';
import { getPostViewCount } from '../db/queries';
import { parseId } from '../utils/validation';

const stats = new Hono<{ Bindings: Env }>();

// 获取浏览数（读物化值 posts.view_count）。
// 写入只发生在帖子详情路径（GET /api/posts/:id）里，每访客每帖只计一次；
// 原先的 POST /view/:postId 用 IP 当访客标识、与详情路径口径不同（会重复计数），已移除。
stats.get('/view/:postId', async (c) => {
  const postId = parseId(c.req.param('postId'));
  if (postId === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);
  const count = await getPostViewCount(c.env.DB, postId);
  return c.json({ success: true, data: { postId, viewCount: count } });
});

export default stats;
