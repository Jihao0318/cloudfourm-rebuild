import { Context, Next } from 'hono';
import { verifyToken } from '../utils/jwt';
import type { Env, JWTPayload, User } from '../types';

// 彻底清理用户所有数据的通用函数
export async function cleanupUser(db: D1Database, userId: number): Promise<void> {
  // 清理用户的会话消息（先清理参与者关联，再清理会话和消息）
  await db.batch([
    db.prepare('DELETE FROM likes WHERE user_id = ?').bind(userId),
    db.prepare("DELETE FROM likes WHERE target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE user_id = ?)").bind(userId),
    db.prepare("DELETE FROM likes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE user_id = ?)").bind(userId),
    db.prepare('DELETE FROM verifications WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM comments WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)').bind(userId),
    db.prepare('DELETE FROM page_views WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)').bind(userId),
    db.prepare('DELETE FROM check_ins WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM user_balances WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM user_vips WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM coin_transactions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM lottery_records WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM notifications WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM notifications WHERE actor_id = ?').bind(userId),
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM follows WHERE follower_id = ?').bind(userId),
    db.prepare('DELETE FROM follows WHERE following_id = ?').bind(userId),
    db.prepare('DELETE FROM reports WHERE reporter_id = ?').bind(userId),
    db.prepare("DELETE FROM reports WHERE target_id IN (SELECT id FROM posts WHERE user_id = ?) AND target_type = 'post'").bind(userId),
    db.prepare("DELETE FROM reports WHERE target_id IN (SELECT id FROM comments WHERE user_id = ?) AND target_type = 'comment'").bind(userId),
    db.prepare('DELETE FROM messages WHERE sender_id = ?').bind(userId),
    db.prepare('DELETE FROM conversation_participants WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM push_tokens WHERE user_id = ?').bind(userId),
    // 无级联 FK 表（不删会导致 DELETE users 外键违规、整批回滚卡死注销）
    db.prepare('DELETE FROM invite_codes WHERE created_by = ?').bind(userId),
    db.prepare('DELETE FROM invite_codes WHERE used_by = ?').bind(userId),
    db.prepare('DELETE FROM tips WHERE from_user_id = ?').bind(userId),
    db.prepare('DELETE FROM tips WHERE to_user_id = ?').bind(userId),
    db.prepare('DELETE FROM unban_requests WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM unban_requests WHERE reviewer_id = ?').bind(userId),
    db.prepare('DELETE FROM user_items WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM user_patrol_stats WHERE user_id = ?').bind(userId),
    // 无 FK 的孤儿残留（不删会永久残留）
    db.prepare('DELETE FROM red_packets WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM red_packet_claims WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM security_logs WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM login_attempts WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM post_review_actions WHERE reviewer_id = ?').bind(userId),
    db.prepare('DELETE FROM report_review_actions WHERE reviewer_id = ?').bind(userId),
  ]);
  // 批量清理已经没有参与者的空会话（参与者在上面 batch 中已被删除）
  await db.prepare(`
    DELETE FROM messages WHERE conversation_id IN (
      SELECT id FROM conversations WHERE id NOT IN (
        SELECT DISTINCT conversation_id FROM conversation_participants
      )
    )
  `).run();
  await db.prepare(`
    DELETE FROM conversations WHERE id NOT IN (
      SELECT DISTINCT conversation_id FROM conversation_participants
    )
  `).run();
  await db.batch([
    db.prepare('DELETE FROM posts WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}

// JWT 鉴权中间件 — 必须登录
export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: '未登录，请先登录' }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ success: false, error: '登录已过期，请重新登录' }, 401);
  }

  // 查出用户信息（排除敏感字段），后续 handler 可从 c.get('dbUser') 获取
  const dbUser = await c.env.DB
    .prepare('SELECT id, username, email, avatar_url, bio, role, banned_until, scheduled_deleted_at, custom_title, nick_theme, title_badge, title_badge_expires_at, avatar_frame, avatar_frame_expires_at, created_at, deleted_at, email_verified, twofa_enabled, token_version FROM users WHERE id = ?')
    .bind(payload.userId)
    .first<User>();

  if (!dbUser) {
    return c.json({ success: false, error: '用户不存在' }, 404);
  }

  // token 版本校验：改密/改邮箱/重放检测会 +1，旧 token（含未带 ver 的历史 token）全部失效
  if (payload.ver === undefined || payload.ver !== dbUser.token_version) {
    return c.json({ success: false, error: '登录已过期' }, 401);
  }

  if (dbUser.scheduled_deleted_at) {
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    if (dbUser.scheduled_deleted_at <= nowStr) {
      await cleanupUser(c.env.DB, payload.userId);
      return c.json({ success: false, error: '账户已注销' }, 404);
    }
  }

  // 检查是否被封禁（自赎接口豁免；auth/me 与 logout 放行——封禁用户需保持登录态才能自赎/主动登出）
  // 注意：path 去尾斜杠再匹配，避免 /api/unban 与 /api/unban/ 不一致的边界问题
  const p = c.req.path.split('?')[0].replace(/\/+$/, '');
  if (dbUser.banned_until && !p.startsWith('/api/unban') && p !== '/api/auth/me' && p !== '/api/auth/logout') {
    const bannedUntil = new Date(dbUser.banned_until.replace(' ', 'T') + 'Z');
    if (bannedUntil.getTime() > Date.now()) {
      const until = bannedUntil.toISOString().replace("T", " ").slice(0, 19) + " UTC";
      return c.json({ success: false, error: `账号已被封禁至 ${until}` }, 403);
    }
  }

  c.set('user', payload);
  c.set('dbUser', dbUser);

  await next();
}

// 可选鉴权 — 有 token 则解析，没有也行
// 与 requireAuth 不同：不校验封禁/注销（公开页仅需登录态显示），但校验签名、用户存在与 token_version
// （已吊销/已删除用户的旧 token 不应再被识别为登录态）
export async function optionalAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload) {
      const dbUser = await c.env.DB
        .prepare('SELECT token_version FROM users WHERE id = ? AND deleted_at IS NULL')
        .bind(payload.userId)
        .first<{ token_version: number }>();
      // ver 缺失或与 DB 不一致（改密/登出/重放后）→ 视为未登录
      if (dbUser && payload.ver !== undefined && payload.ver === dbUser.token_version) {
        c.set('user', payload);
      }
    }
  }
  await next();
}

// 管理员权限中间件（admin + moderator）
export async function requireAdmin(c: Context<{ Bindings: Env }>, next: Next) {
  // 从 dbUser 读实时角色，而不是 JWT 快照——管理员被提权后旧 JWT 仍有效
  // ponytail: requireAuth 已经查了 DB 并存入 c.get('dbUser')，直接复用
  const dbUser: User = c.get('dbUser');
  if (!dbUser || (dbUser.role !== 'admin' && dbUser.role !== 'moderator')) {
    return c.json({ success: false, error: '权限不足' }, 403);
  }
  await next();
}

// 超管权限中间件（仅 admin，巡查员不可用）
export async function requireAdminRole(c: Context<{ Bindings: Env }>, next: Next) {
  const dbUser: User = c.get('dbUser');
  if (!dbUser || dbUser.role !== 'admin') {
    return c.json({ success: false, error: '权限不足' }, 403);
  }
  await next();
}

// ===== 封禁检查中间件 =====
// requireAuth 已统一检查封禁状态；此中间件供「仅封禁检查、不设 dbUser」的场景复用（补实原空实现）
export async function checkNotBanned(c: Context<{ Bindings: Env }>, next: Next) {
  const user: JWTPayload | undefined = c.get('user');
  if (user) {
    const dbUser = await c.env.DB
      .prepare('SELECT banned_until FROM users WHERE id = ?')
      .bind(user.userId)
      .first<{ banned_until: string | null }>();
    if (dbUser?.banned_until) {
      const bannedUntil = new Date(dbUser.banned_until.replace(' ', 'T') + 'Z');
      if (bannedUntil.getTime() > Date.now()) {
        return c.json({ success: false, error: '账号已被封禁，无法执行此操作' }, 403);
      }
    }
  }
  await next();
}
