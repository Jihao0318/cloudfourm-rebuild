import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { getPublicUser, getUserById, updateUser } from '../db/queries';
import { requireAuth } from '../middleware/auth';
import { parseId, validateUsername } from '../utils/validation';

// LIKE 模式转义通配符，防止用户输入中的 %/_ 被当作通配符
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

const users = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 查看用户资料 (公开)
users.get('/:id/profile', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的用户ID' }, 400);
  const profile = await getPublicUser(c.env.DB, id);
  if (!profile) return c.json({ success: false, error: '用户不存在' }, 404);

  return c.json({ success: true, data: profile });
});

// 更新个人资料
users.put('/profile', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { username, bio } = await c.req.json();

  const updates: any = {};
  if (username !== undefined) {
    // 与 auth.ts /username 同规则校验，防止写入非法用户名（JWT payload 与 DB 不一致）
    const check = validateUsername(username);
    if (!check.valid) return c.json({ success: false, error: check.error }, 400);
    updates.username = username;
  }
  if (bio !== undefined) updates.bio = bio;

  await updateUser(c.env.DB, user.userId, updates);
  return c.json({ success: true, message: '资料已更新' });
});

// 更新背景图
users.put('/banner', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { banner_url } = await c.req.json();
  if (!banner_url) return c.json({ success: false, error: 'URL 不能为空' }, 400);
  await updateUser(c.env.DB, user.userId, { banner_url });
  return c.json({ success: true, message: '背景图已更新', data: { banner_url } });
});

// 更新头像 (存储 URL)
users.put('/avatar', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { avatar_url } = await c.req.json();

  if (!avatar_url) return c.json({ success: false, error: '头像 URL 不能为空' }, 400);

  await updateUser(c.env.DB, user.userId, { avatar_url });
  return c.json({ success: true, message: '头像已更新', data: { avatar_url } });
});

// 自定义头衔（VIP / S VIP / S VIP+ 均可使用；永久态：expires_at 恒为 NULL，
// 与 items.ts use/custom-title 的限时称号区分——后者到期后不覆盖/不丢失 VIP 头衔）
users.put('/title', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);

  // 从数据库实时查询 VIP 状态（JWT 可能过时）
  const vipInfo = await c.env.DB
    .prepare("SELECT tier FROM user_vips WHERE user_id = ? AND expires_at > datetime('now')")
    .bind(user.userId)
    .first<{ tier: string }>();
  if (!vipInfo) return c.json({ success: false, error: '仅 VIP 会员可用' }, 403);

  const { title } = await c.req.json();
  if (!title || title.length > 30) return c.json({ success: false, error: '头衔长度不能超过 30 个字符' }, 400);

  await c.env.DB
    .prepare('UPDATE users SET custom_title = ?, custom_title_expires_at = NULL WHERE id = ?')
    .bind(title.trim(), user.userId)
    .run();

  return c.json({ success: true, message: '头衔已更新', data: { custom_title: title.trim() } });
});

// 清除自定义头衔（VIP 永久头衔清除入口；不要求 VIP 有效——VIP 过期后也应能清除，
// 否则 items.ts use/custom-title 的「请先清除 VIP 头衔」会把用户永久卡死）
users.delete('/title', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);

  await c.env.DB
    .prepare('UPDATE users SET custom_title = NULL, custom_title_expires_at = NULL WHERE id = ?')
    .bind(user.userId)
    .run();

  return c.json({ success: true, message: '头衔已清除' });
});

// 设置昵称主题（仅 S VIP+）
users.put('/nick-theme', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);

  // 从数据库实时查询 VIP 等级（JWT 可能过时）
  const vipInfo = await c.env.DB
    .prepare("SELECT tier FROM user_vips WHERE user_id = ? AND expires_at > datetime('now')")
    .bind(user.userId)
    .first<{ tier: string }>();
  if (!vipInfo || vipInfo.tier !== 'svip+') return c.json({ success: false, error: '仅 S VIP+ 会员可用' }, 403);

  const { theme } = await c.req.json();
  const validThemes = ['theme1', 'theme2', 'theme3', 'theme4'];
  if (!theme || !validThemes.includes(theme)) return c.json({ success: false, error: '无效的主题' }, 400);

  await c.env.DB
    .prepare('UPDATE users SET nick_theme = ? WHERE id = ?')
    .bind(theme, user.userId)
    .run();

  return c.json({ success: true, message: '主题已更新', data: { nick_theme: theme } });
});

// 通知设置
users.put('/notify-settings', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { notify_on_reply, notify_on_like } = await c.req.json();

  const updates: any = {};
  if (notify_on_reply !== undefined) updates.notify_on_reply = notify_on_reply ? 1 : 0;
  if (notify_on_like !== undefined) updates.notify_on_like = notify_on_like ? 1 : 0;

  await updateUser(c.env.DB, user.userId, updates);
  return c.json({ success: true, message: '通知设置已更新' });
});

// 用户搜索（公开）
users.get('/search', async (c) => {
  const q = c.req.query('q') || '';
  if (!q || q.length < 2) return c.json({ success: true, data: [] });

  // 用户输入先经 escapeLike 转义通配符，并声明 ESCAPE '\'，防止 %/_ 被当作通配符
  const results = await c.env.DB
    .prepare("SELECT id, username, avatar_url FROM users WHERE deleted_at IS NULL AND username LIKE ? ESCAPE '\\' LIMIT 10")
    .bind(`%${escapeLike(q)}%`)
    .all();

  return c.json({ success: true, data: results.results });
});

export default users;
