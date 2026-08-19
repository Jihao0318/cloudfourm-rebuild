import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';

const push = new Hono<{ Bindings: Env }>();

// 存储设备 token
push.post('/subscribe', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { token, platform } = await c.req.json();

  if (!token || !platform) {
    return c.json({ success: false, error: '缺少 token 或平台信息' }, 400);
  }

  // upsert: 同一用户同一平台只保留最新 token
  await c.env.DB
    .prepare(`INSERT INTO push_tokens (user_id, token, platform) VALUES (?, ?, ?)
      ON CONFLICT(user_id, platform) DO UPDATE SET token = ?, updated_at = datetime('now')`)
    .bind(user.userId, token, platform, token)
    .run();

  return c.json({ success: true, message: '已订阅推送' });
});

// 取消订阅
push.post('/unsubscribe', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  const { platform } = await c.req.json();

  await c.env.DB
    .prepare('DELETE FROM push_tokens WHERE user_id = ? AND platform = ?')
    .bind(user.userId, platform || 'android')
    .run();

  return c.json({ success: true, message: '已取消订阅' });
});

export default push;
