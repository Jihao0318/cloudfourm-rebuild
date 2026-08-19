import { Hono } from 'hono';
import type { Env } from '../types';
import { recordPageView, getPostViewCount } from '../db/queries';
import { parseId } from '../utils/validation';

const stats = new Hono<{ Bindings: Env }>();

// 记录浏览
stats.post('/view/:postId', async (c) => {
  const postId = parseId(c.req.param('postId'));
  if (postId === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);
  const visitorId = c.req.header('CF-Connecting-IP') || 'anonymous';

  await recordPageView(c.env.DB, postId, visitorId);
  return c.json({ success: true, message: 'ok' });
});

// 获取浏览数
stats.get('/view/:postId', async (c) => {
  const postId = parseId(c.req.param('postId'));
  if (postId === null) return c.json({ success: false, error: '无效的帖子ID' }, 400);
  const count = await getPostViewCount(c.env.DB, postId);
  return c.json({ success: true, data: { postId, viewCount: count } });
});

export default stats;
