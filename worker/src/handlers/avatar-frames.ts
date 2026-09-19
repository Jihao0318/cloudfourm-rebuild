import { Hono } from 'hono';
import type { Env } from '../types';

// 公开头像框列表（无需登录）：前端 Avatar 渲染用；仅返回上架中的框
const avatarFrames = new Hono<{ Bindings: Env }>();

avatarFrames.get('/', async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT id, name, image_url, scale, offset_x, offset_y FROM avatar_frames WHERE enabled = 1 ORDER BY id ASC')
    .all();
  return c.json({ success: true, data: rows.results || [] });
});

export default avatarFrames;
