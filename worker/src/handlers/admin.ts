import { Hono } from 'hono';
import type { Env, JWTPayload, User } from '../types';
import {
  listUsers, updateUserRole, updateUser, getAllSettings, setSetting, getSetting, getTotalStats,
  listPosts, getPostById, hardDeletePost, hardDeleteComment,
  listPinnedPosts, togglePinPost, createNotification,
} from '../db/queries';
import { requireAuth, requireAdmin, requireAdminRole } from '../middleware/auth';
import { parseId } from '../utils/validation';
import { hashPassword } from '../utils/password';
import { cleanupTransactions } from './coins';

// LIKE 模式转义通配符，防止用户输入中的 %/_ 被当作通配符
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

const admin = new Hono<{ Bindings: Env }>();

// 路径守卫：admin 全部放行，moderator 仅限 posts/comments/reports 管理
// （用单一路径守卫，避免多层 use 堆叠的坑）
admin.use('*', async (c, next) => {
  // 自包含鉴权：父级 app.use('/api/admin*', requireAuth) 在本子应用 use 之后才执行，
  // 无法依赖其 c.set('dbUser')，故在此显式调用（next 传空函数避免提前派发）
  await requireAuth(c, async () => {});
  const dbUser = c.get('dbUser');
  if (!dbUser) return c.json({ success: false, error: '未登录' }, 401);
  const modAllowed = /\/admin\/(posts|comments|reports)(\/|$)/.test(c.req.path);
  if (dbUser.role === 'admin' || (dbUser.role === 'moderator' && modAllowed)) {
    await next();
  } else {
    return c.json({ success: false, error: '权限不足' }, 403);
  }
});

// ===== 用户管理 =====

admin.get('/users', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '20');
  const { users, total } = await listUsers(c.env.DB, page, pageSize);
  const safeUsers = users.map((u: any) => ({
    id: u.id, username: u.username, email: u.email, role: u.role,
    email_verified: u.email_verified, email_change_ordered: u.email_change_ordered,
    twofa_enabled: u.twofa_enabled, created_at: u.created_at,
  }));
  return c.json({ success: true, data: safeUsers, total, page, pageSize });
});

// ===== 管理员验证（独立于 JWT，从 DB 实时读取）=====
admin.get('/verify', async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const dbUser = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(user.userId).first<{ role: string }>();
  const isAdmin = dbUser?.role === 'admin';
  return c.json({
    success: true,
    data: {
      is_admin: isAdmin,
      role: dbUser?.role || 'unknown',
      user_id: user.userId,
      username: user.username,
    },
  });
});

// ===== 角色管理（仅超级管理员可操作）=====
admin.get('/users/roles', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const { users, total } = await listUsers(c.env.DB, page, 50);
  const roles = users.map((u: any) => ({
    id: u.id, username: u.username, email: u.email, role: u.role, created_at: u.created_at,
  }));
  return c.json({ success: true, data: roles, total });
});

admin.put('/users/:id/role', requireAuth, async (c) => {
  try {
    const currentUser: JWTPayload = c.get('user');
    // 角色判断必须用 DB 实时行（dbUser，requireAuth 已查询注入），JWT payload 只有 {userId, username, ver}，没有 role 字段
    const dbUser: User | undefined = c.get('dbUser');

    const targetId = parseId(c.req.param('id'));
    if (targetId === null) return c.json({ success: false, error: '无效的用户ID' }, 400);
    if (isNaN(targetId)) return c.json({ success: false, error: '无效的用户ID' }, 400);

    const body = await c.req.json();
    const role = body.role;

    if (!role || !['user', 'moderator', 'admin'].includes(role)) {
      return c.json({ success: false, error: '无效的角色' }, 400);
    }
    if (targetId === currentUser.userId) {
      return c.json({ success: false, error: '不能修改自己的角色' }, 403);
    }

    // 仅 admin 可以授予 admin 角色
    if (role === 'admin' && dbUser?.role !== 'admin') {
      return c.json({ success: false, error: '只有管理员可以授予管理员权限' }, 403);
    }

    // 防止移除最后一个管理员
    if (targetId !== currentUser.userId && role !== 'admin') {
      const targetUser = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(targetId).first<{ role: string }>();
      if (targetUser?.role === 'admin') {
        const adminCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").first<{ count: number }>();
        if (adminCount && adminCount.count <= 1) {
          return c.json({ success: false, error: '不能移除最后一个管理员' }, 403);
        }
      }
    }

    await updateUserRole(c.env.DB, targetId, role);
    return c.json({
      success: true,
      message: role === 'admin' ? '已升级为管理员' : role === 'moderator' ? '已设为巡查员' : '已降级为普通用户',
    });
  } catch (err: any) {
    console.error('角色变更错误:', err);
    return c.json({ success: false, error: '角色变更失败' }, 500);
  }
});

// ===== 系统设置 =====

admin.get('/settings', async (c) => {
  const settings = await getAllSettings(c.env.DB);
  return c.json({ success: true, data: settings });
});

admin.put('/settings', async (c) => {
  const settings = await c.req.json();
  // 白名单：只允许写入预设的配置键
  // registration_enabled / email_verification_required 由 auth.ts 注册/登录端点消费
  // 巡查 v2（068）：patrol_pass_limit 巡查放行票 / patrol_violation_limit 巡查违规票 /
  //   report_pass_limit 举报放行票 / report_violation_limit 举报违规票 /
  //   review_reject_coins 打回扣分 / review_takedown_coins 举报下架扣分 /
  //   soft_delete_retention_days 软删保留天数（moderation.ts / admin.ts / index.ts 消费）
  const ALLOWED_KEYS = new Set([
    'site_name', 'site_description', 'register_enabled', 'invite_only',
    'check_in_enabled', 'post_audit_enabled', 'default_user_coins',
    'announcement', 'maintenance_mode', 'contact_email',
    'registration_enabled', 'email_verification_required',
    'patrol_pass_limit', 'patrol_violation_limit',
    'report_pass_limit', 'report_violation_limit',
    'review_reject_coins', 'review_takedown_coins', 'report_reward_coins',
    'appeal_review_level',
    'soft_delete_retention_days',
    // AI 异步审核（aiReview.ts 消费）：开关（含熔断自动关闭后的人工恢复）、
    // judge 超时（ai_review_timeout_ms）、熔断阈值（ai_review_circuit_break_threshold）、
    // 置信度分流阈值（ai_review_confidence_threshold，0-100：pass 低于该值进待复核）、
    // 审核后端（ai_review_backend：workers-ai=Cloudflare 官方 / gemini=Gemini，未设置按 workers-ai）；
    // ai_review_fail_count 为内部连续失败计数（任一成功自动清零），不对后台开放
    'ai_review_enabled', 'ai_review_timeout_ms', 'ai_review_circuit_break_threshold',
    'ai_review_confidence_threshold', 'ai_review_backend',
  ]);
  for (const [key, value] of Object.entries(settings)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (typeof value !== 'string') continue;
    // 审核后端只接受这两个取值：非法值在消费端会被当成默认后端（静默），这里直接拒绝更易发现
    if (key === 'ai_review_backend' && value !== 'workers-ai' && value !== 'gemini') {
      return c.json({ success: false, error: 'ai_review_backend 只能是 workers-ai 或 gemini' }, 400);
    }
    await setSetting(c.env.DB, key, value);
  }
  return c.json({ success: true, message: '设置已更新' });
});

// ===== 封禁用户 =====
admin.put('/users/:id/ban', async (c) => {
  try {
    const targetId = parseId(c.req.param('id'));
    if (targetId === null) return c.json({ success: false, error: '无效的用户ID' }, 400);
    const body = await c.req.json();
    const { duration, unit, reason } = body;

    const durationNum = Number(duration);
    if (!Number.isFinite(durationNum) || durationNum < 1 || durationNum > 8760) {
      return c.json({ success: false, error: '请输入有效的封禁时长（1-8760 之间的数字）' }, 400);
    }
    if (!['hours', 'days'].includes(unit)) return c.json({ success: false, error: '单位必须是 hours 或 days' }, 400);
    // 封禁原因（解封审核时展示给管理员判断；最多 200 字）
    const banReason = String(reason || '').trim().slice(0, 200);

    const targetUser = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(targetId).first<{ role: string }>();
    if (!targetUser) return c.json({ success: false, error: '用户不存在' }, 404);
    if (targetUser.role === 'admin') return c.json({ success: false, error: '不能封禁管理员' }, 403);

    const multiplier = unit === 'days' ? 24 : 1;
    const totalHours = Math.floor(durationNum * multiplier);
    const result = await c.env.DB.prepare("UPDATE users SET banned_until = datetime('now', ?), ban_reason = ? WHERE id = ?").bind(`+${totalHours} hours`, banReason, targetId).run();

    const label = unit === 'days' ? '天' : '小时';
    return c.json({ success: true, message: `用户已被封禁 ${duration} ${label}` });
  } catch (err: any) {
    return c.json({ success: false, error: '封禁失败' }, 500);
  }
});

// 解封用户
admin.delete('/users/:id/ban', async (c) => {
  try {
    const targetId = parseId(c.req.param('id'));
    if (targetId === null) return c.json({ success: false, error: '无效的用户ID' }, 400);
    await c.env.DB.prepare('UPDATE users SET banned_until = NULL, ban_reason = NULL WHERE id = ?').bind(targetId).run();
    return c.json({ success: true, message: '用户已解封' });
  } catch (err: any) {
    return c.json({ success: false, error: '解封失败' }, 500);
  }
});

// ===== 密码重置 + 安全日志 =====

// 重置用户密码（仅管理员）：生成临时密码，明文仅此一次返回，并记安全日志
// 责令更换邮箱：要求用户下次登录前换绑新邮箱（旧邮箱不可信场景）
admin.put('/users/:id/order-email-change', requireAdminRole, async (c) => {
  const id = parseId(c.req.param('id') ?? '');
  if (id === null) return c.json({ success: false, error: '无效的用户ID' }, 400);
  const { reason } = await c.req.json().catch(() => ({}));
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmed || trimmed.length > 200) return c.json({ success: false, error: '请填写责令原因（1-200 字，将展示给用户）' }, 400);
  const target = await c.env.DB
    .prepare('SELECT id, username FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<{ id: number; username: string }>();
  if (!target) return c.json({ success: false, error: '用户不存在' }, 404);

  await c.env.DB
    .prepare("UPDATE users SET email_change_ordered = 1, email_change_reason = ?, email_change_ordered_at = datetime('now') WHERE id = ?")
    .bind(trimmed, id)
    .run();
  await c.env.DB
    .prepare("INSERT INTO notifications (user_id, type, content, read) VALUES (?, 'email_change_ordered', ?, 0)")
    .bind(id, `管理员要求你更换绑定邮箱（原因：${trimmed}）。请在登录状态下前往个人资料页完成更换；退出后登录时也会被引导完成。`)
    .run()
    .catch(() => {});
  await c.env.DB
    .prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'email_change_ordered', ?)")
    .bind(id, `管理员责令更换邮箱：${trimmed}`)
    .run()
    .catch(() => {});
  return c.json({ success: true, message: `已责令用户「${target.username}」更换邮箱` });
});

// 解除责令（用户线下沟通解决后，管理员人工解除；用户完成换邮箱后也会自动清除）
admin.put('/users/:id/cancel-email-change', requireAdminRole, async (c) => {
  const id = parseId(c.req.param('id') ?? '');
  if (id === null) return c.json({ success: false, error: '无效的用户ID' }, 400);
  const res = await c.env.DB
    .prepare('UPDATE users SET email_change_ordered = 0, email_change_reason = NULL, email_change_ordered_at = NULL WHERE id = ? AND email_change_ordered = 1')
    .bind(id)
    .run();
  if (!res.meta.changes) return c.json({ success: false, error: '该用户未处于责令状态' }, 409);
  await c.env.DB
    .prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'email_change_ordered', '管理员解除责令更换邮箱')")
    .bind(id)
    .run()
    .catch(() => {});
  return c.json({ success: true, message: '已解除责令' });
});

// 管理员直接设置邮箱验证状态：线下核实身份后人工放行（verified=1），
// 或强制要求用户重新验证（verified=0，配合邮箱验证开启时下次登录将被拦）
admin.put('/users/:id/email-verified', requireAdminRole, async (c) => {
  const id = parseId(c.req.param('id') ?? '');
  if (id === null) return c.json({ success: false, error: '无效的用户ID' }, 400);
  const { verified } = await c.req.json().catch(() => ({}));
  if (verified !== 0 && verified !== 1) return c.json({ success: false, error: '参数无效（verified 须为 0 或 1）' }, 400);
  const res = await c.env.DB
    .prepare("UPDATE users SET email_verified = ?, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL")
    .bind(verified, id)
    .run();
  if (!res.meta.changes) return c.json({ success: false, error: '用户不存在' }, 404);
  await c.env.DB
    .prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'email_verified_admin', ?)")
    .bind(id, verified === 1 ? '管理员将邮箱标记为已验证' : '管理员将邮箱标记为未验证')
    .run()
    .catch(() => {});
  return c.json({ success: true, message: verified === 1 ? '已标记为已验证' : '已标记为未验证' });
});

admin.put('/users/:id/reset-password', requireAdminRole, async (c) => {
  try {
    const targetId = parseId(c.req.param('id'));
    if (targetId === null) return c.json({ success: false, error: '无效的用户ID' }, 400);

    const target = await c.env.DB
      .prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL')
      .bind(targetId)
      .first<{ id: number }>();
    if (!target) return c.json({ success: false, error: '用户不存在' }, 404);

    // 生成 8 位临时密码：大写+小写+数字混合（去掉易混淆字符），Fisher-Yates 打乱
    const pick = (chars: string, n: number) => {
      const buf = new Uint8Array(n);
      crypto.getRandomValues(buf);
      let s = '';
      for (let i = 0; i < n; i++) s += chars[buf[i] % chars.length];
      return s;
    };
    const parts = pick('ABCDEFGHJKLMNPQRSTUVWXYZ', 3) + pick('abcdefghjkmnpqrstuvwxyz', 3) + pick('23456789', 2);
    const arr = parts.split('');
    for (let i = arr.length - 1; i > 0; i--) {
      const j = new Uint8Array(1);
      crypto.getRandomValues(j);
      const k = j[0] % (i + 1);
      [arr[i], arr[k]] = [arr[k], arr[i]];
    }
    const temporaryPassword = arr.join('');

    const passwordHash = await hashPassword(temporaryPassword);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').bind(passwordHash, targetId),
      c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'reset_password', '管理员重置密码')").bind(targetId),
    ]);

    return c.json({ success: true, data: { temporary_password: temporaryPassword } });
  } catch (err: any) {
    console.error('[admin] reset password error:', err);
    return c.json({ success: false, error: '重置密码失败' }, 500);
  }
});

// 安全日志（仅管理员）：分页，LEFT JOIN 用户昵称
admin.get('/security-logs', requireAdminRole, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(Math.max(1, parseInt(c.req.query('pageSize') || '20')), 100);
  const offset = (page - 1) * pageSize;

  const total = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM security_logs').first<{ cnt: number }>();

  const rows = await c.env.DB
    .prepare(`
      SELECT l.id, l.user_id, u.username, l.action, l.detail, l.created_at
      FROM security_logs l LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.id DESC LIMIT ? OFFSET ?
    `)
    .bind(pageSize, offset)
    .all();

  return c.json({ success: true, data: rows.results, total: total?.cnt || 0, page, pageSize });
});

// ===== 修改用户昵称 =====
admin.put('/users/:id/username', async (c) => {
  try {
    const targetId = parseId(c.req.param('id'));
    if (targetId === null) return c.json({ success: false, error: '无效的用户ID' }, 400);
    const { username } = await c.req.json();
    if (!username || username.length < 3 || username.length > 20) {
      return c.json({ success: false, error: '昵称长度需在 3-20 个字符之间' }, 400);
    }
    const existing = await c.env.DB
      .prepare('SELECT id FROM users WHERE username = ? AND id != ? AND deleted_at IS NULL')
      .bind(username, targetId)
      .first<{ id: number }>();
    if (existing) return c.json({ success: false, error: '该昵称已被使用' }, 409);

    await updateUser(c.env.DB, targetId, { username });
    return c.json({ success: true, message: `昵称已修改为「${username}」` });
  } catch (err: any) {
    return c.json({ success: false, error: '修改失败' }, 500);
  }
});

// ===== 删除用户（管理员）=====
admin.delete('/users/:id', async (c) => {
  const targetId = parseId(c.req.param('id'));
  if (targetId === null) return c.json({ success: false, error: '无效的用户ID' }, 400);

  // 读 confirm — 单独 try-catch，区分是 body 解析失败还是 SQL 失败
  let confirm = 0;
  try {
    const body = await c.req.json();
    confirm = body.confirm || 0;
  } catch {
    return c.json({ success: false, error: '请求体解析失败' }, 400);
  }
  if (confirm < 3) return c.json({ success: false, error: '需要三次确认' }, 400);

  // D1 默认启用 FK 约束，先关掉避免删除顺序导致 FK 冲突
  // PRAGMA 单独执行、不放进 batch（PRAGMA 在 D1 batch 中行为不可靠）
  await c.env.DB.prepare('PRAGMA foreign_keys = OFF').run();

  // ponytail: 用 try/finally 确保无论成功/失败都恢复外键约束
  try {
    // 全部 DELETE 按原顺序放入数组。batch 内语句按顺序执行、同一事务内相互可见，
    // 与逐条 await 的语义一致；各语句只绑定 targetId，均不依赖前序语句的返回值
    // （含 IN (SELECT ...) 子查询的语句也只会看到 posts/comments 的既有行，
    //   这两张表的删除位于数组末尾，可见性与逐条执行完全相同）
    // D1 单次 batch 上限 100 条：28 条 DELETE 一次 batch 完成，网络往返从 28 次降为 1 次
    // batch 原子性：任一语句失败整批回滚、不留半删状态（优于原逐条执行——原先某条失败会留下半删数据）
    const deletes = [
      c.env.DB.prepare("DELETE FROM likes WHERE user_id = ?").bind(targetId),
      c.env.DB.prepare("DELETE FROM likes WHERE target_id IN (SELECT id FROM posts WHERE user_id = ?) AND target_type = 'post'").bind(targetId),
      c.env.DB.prepare("DELETE FROM likes WHERE target_id IN (SELECT id FROM comments WHERE user_id = ?) AND target_type = 'comment'").bind(targetId),
      c.env.DB.prepare('DELETE FROM comments WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)').bind(targetId),
      c.env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM notifications WHERE actor_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM bookmarks WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM follows WHERE follower_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM follows WHERE following_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM reports WHERE reporter_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM messages WHERE sender_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM conversation_participants WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM verifications WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM check_ins WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM user_balances WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM user_vips WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM coin_transactions WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM lottery_records WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM unban_requests WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM user_items WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM user_lottery_items WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM user_vip_tickets WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM tax_logs WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM achievements WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM daily_tasks WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM thanks WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM user_patrol_stats WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM report_review_actions WHERE reviewer_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM appeals WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM lottery_pity WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM lottery_announcements WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM user_announcements WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM page_views WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)').bind(targetId),
      c.env.DB.prepare('DELETE FROM posts WHERE user_id = ?').bind(targetId),
      c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId),
    ];

    // 每块 ≤80 条分块（D1 batch 上限 100 条，留余量）；当前 28 条一次 batch 即完成（1 次往返）
    for (let i = 0; i < deletes.length; i += 80) {
      await c.env.DB.batch(deletes.slice(i, i + 80));
    }

    return c.json({ success: true, message: '用户已彻底删除' });
  } catch (err: any) {
    console.error('[admin] delete user error:', err);
    return c.json({ success: false, error: `删除失败: ${err.message}` }, 500);
  } finally {
    await c.env.DB.prepare('PRAGMA foreign_keys = ON').run();
  }
});

// ===== 置顶管理 =====

admin.get('/pinned', async (c) => {
  const posts = await listPinnedPosts(c.env.DB);
  return c.json({ success: true, data: posts });
});

admin.put('/pinned/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的ID' }, 400);
  const { is_pinned } = await c.req.json();
  await togglePinPost(c.env.DB, id, is_pinned);
  return c.json({ success: true, message: is_pinned ? '已置顶' : '已取消置顶' });
});

// 置顶排序：交换 updated_at 实现排序
admin.put('/pinned/:id/reorder', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的ID' }, 400);
  const { direction } = await c.req.json();
  const pinned = await listPinnedPosts(c.env.DB);
  const idx = pinned.findIndex((p: any) => p.id === id);
  if (idx < 0) return c.json({ success: false, error: '帖子未置顶' }, 404);

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= pinned.length)
    return c.json({ success: false, error: '无法移动' }, 400);

  const curr = pinned[idx] as any;
  const target = pinned[swapIdx] as any;
  // 交换 updated_at
  await c.env.DB.prepare('UPDATE posts SET updated_at = ? WHERE id = ?').bind(target.updated_at, curr.id).run();
  await c.env.DB.prepare('UPDATE posts SET updated_at = ? WHERE id = ?').bind(curr.updated_at, target.id).run();
  return c.json({ success: true, message: '排序已更新' });
});

// ===== 积分管理 =====

// 查询所有用户积分
admin.get('/coins', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const total = await c.env.DB
    .prepare("SELECT COUNT(*) as cnt FROM users u WHERE u.deleted_at IS NULL")
    .first<{ cnt: number }>();

  const balances = await c.env.DB
    .prepare(`
      SELECT u.id as user_id, u.username, u.role, COALESCE(b.coins, 0) as coins, COALESCE(b.total_earned, 0) as total_earned, COALESCE(b.total_spent, 0) as total_spent
      FROM users u
      LEFT JOIN user_balances b ON u.id = b.user_id
      WHERE u.deleted_at IS NULL
      ORDER BY coins DESC LIMIT ? OFFSET ?
    `)
    .bind(pageSize, offset)
    .all();

  return c.json({ success: true, data: balances.results, total: total?.cnt || 0, page, pageSize });
});

// 管理员调整积分（增加或扣除）
admin.post('/coins/adjust', async (c) => {
  const { user_id, amount, reason } = await c.req.json();

  if (!user_id || !amount || amount === 0) {
    return c.json({ success: false, error: '参数无效' }, 400);
  }

  const target = await c.env.DB
    .prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL")
    .bind(user_id)
    .first<{ id: number }>();
  if (!target) return c.json({ success: false, error: '用户不存在' }, 404);

  if (amount > 0) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?').bind(amount, amount, user_id),
      c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'admin', ?, coins, ? FROM user_balances WHERE user_id = ?").bind(user_id, amount, reason || '管理员操作', user_id),
    ]);
  } else {
    // 扣除积分不能使余额为负
    const bal = await c.env.DB
      .prepare('SELECT coins FROM user_balances WHERE user_id = ?')
      .bind(user_id)
      .first<{ coins: number }>();
    const deductAmount = Math.min(Math.abs(amount), bal?.coins || 0);
    if (deductAmount > 0) {
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ? WHERE user_id = ?').bind(deductAmount, deductAmount, user_id),
        c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'admin', ?, coins, ? FROM user_balances WHERE user_id = ?").bind(user_id, -deductAmount, reason || '管理员扣除', user_id),
      ]);
    }
  }

  // 写入新流水后立即收敛：每用户只保留最近 15 条
  await cleanupTransactions(c.env.DB, user_id);

  return c.json({ success: true, message: '积分已调整' });
});

// ===== 统计概览 =====

admin.get('/stats', async (c) => {
  const stats = await getTotalStats(c.env.DB);
  return c.json({ success: true, data: stats });
});

// ===== VIP 管理 =====

// VIP 用户列表
admin.get('/vips', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const search = c.req.query('search') || '';

  let whereClause = "WHERE v.tier != 'none' AND v.expires_at > datetime('now')";
  const params: any[] = [];
  if (search) {
    whereClause += " AND u.username LIKE ? ESCAPE '\\'";
    params.push(`%${escapeLike(search)}%`);
  }

  const total = await c.env.DB
    .prepare(`SELECT COUNT(*) as cnt FROM user_vips v JOIN users u ON v.user_id = u.id ${whereClause}`)
    .bind(...params)
    .first<{ cnt: number }>();

  const list = await c.env.DB
    .prepare(`
      SELECT v.user_id, u.username, u.role, v.tier, v.started_at, v.expires_at, v.auto_renew
      FROM user_vips v JOIN users u ON v.user_id = u.id
      ${whereClause}
      ORDER BY v.expires_at DESC LIMIT ? OFFSET ?
    `)
    .bind(...params, pageSize, offset)
    .all();

  return c.json({ success: true, data: list.results, total: total?.cnt || 0, page, pageSize });
});

// 设置/修改用户 VIP
admin.put('/vips/:id', async (c) => {
  try {
    const userId = parseId(c.req.param('id'));
    if (userId === null) return c.json({ success: false, error: '无效的用户ID' }, 400);
    const { tier, days } = await c.req.json();

    if (!['vip', 's-vip', 'svip+'].includes(tier)) {
      return c.json({ success: false, error: '无效的 VIP 等级' }, 400);
    }
    if (!days || days < 1) {
      return c.json({ success: false, error: '天数必须大于 0' }, 400);
    }

    // 无论是否已有 VIP，到期时间都从当前时间起算
    const newExpires = new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');

    await c.env.DB
      .prepare("INSERT INTO user_vips (user_id, tier, started_at, expires_at) VALUES (?, ?, datetime('now'), ?) ON CONFLICT(user_id) DO UPDATE SET tier = ?, expires_at = ?, started_at = datetime('now')")
      .bind(userId, tier, newExpires, tier, newExpires)
      .run();

    return c.json({ success: true, message: 'VIP 已更新' });
  } catch (err: any) {
    return c.json({ success: false, error: 'VIP 设置失败' }, 500);
  }
});

// 取消 VIP
admin.delete('/vips/:id', async (c) => {
  const userId = parseId(c.req.param('id'));
  if (userId === null) return c.json({ success: false, error: '无效的用户ID' }, 400);
  await c.env.DB.prepare('DELETE FROM user_vips WHERE user_id = ?').bind(userId).run();
  return c.json({ success: true, message: 'VIP 已取消' });
});

// ===== 帖子管理 =====

admin.get('/posts', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(parseInt(c.req.query('pageSize') || '20'), 50);
  const search = c.req.query('search') || '';
  const userId = c.req.query('userId') ? parseInt(c.req.query('userId')!) : undefined;

  // 匿名帖真实作者仅管理员可见；巡查员（moderator）同样显示「匿名同学」
  const dbUser = c.get('dbUser');
  const isAdmin = dbUser?.role === 'admin';

  const result = await listPosts(c.env.DB, {
    page, pageSize, userId, sort: 'latest', search: search || undefined, includeDeleted: true,
    rawAuthors: isAdmin, // 仅 admin 显示匿名帖真实作者（前端用 is_anonymous 标注「匿名」）
  });

  return c.json({ success: true, data: result.posts, total: result.total, page, pageSize });
});

// 删除帖子
// 删除帖子（仅管理员；巡查员不可直接删）
admin.delete('/posts/:id', requireAdminRole, async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的ID' }, 400);
  await hardDeletePost(c.env.DB, id);
  return c.json({ success: true, message: '帖子已删除' });
});

// 恢复软删帖子（仅管理员；取消 deleted_at，回到待巡查重新过一遍）
// 顺带关闭该帖的 pending 申诉（避免恢复帖仍滞留在待复审列表，decide 再把已恢复帖塞回巡查队列）
admin.put('/posts/:id/restore', requireAdminRole, async (c) => {
  const user = c.get('user') as JWTPayload | undefined;
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的ID' }, 400);
  const post = await c.env.DB
    .prepare('SELECT user_id FROM posts WHERE id = ? AND deleted_at IS NOT NULL')
    .bind(id)
    .first<{ user_id: number }>();
  if (!post) return c.json({ success: false, error: '帖子不存在或未处于软删状态' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE posts SET deleted_at = NULL, review_status = 'pending', review_round = review_round + 1, rejected_at = NULL, flagged_by = NULL, flagged_reason = NULL, violation_count = 0 WHERE id = ?")
      .bind(id),
    c.env.DB.prepare("UPDATE appeals SET status = 'rejected', decided_by = ?, decided_at = datetime('now') WHERE post_id = ? AND status = 'pending'")
      .bind(user?.userId ?? 0, id),
    c.env.DB.prepare("INSERT INTO notifications (user_id, type, post_id, content, read) VALUES (?, 'system', ?, ?, 0)")
      .bind(post.user_id, id, '帖子已被管理员恢复，申诉自动关闭'),
  ]);
  return c.json({ success: true, message: '帖子已恢复，重新进入待巡查队列' });
});

// 锁定/解锁帖子
admin.put('/posts/:id/lock', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的ID' }, 400);
  const { is_locked } = await c.req.json();
  await c.env.DB.prepare('UPDATE posts SET is_locked = ? WHERE id = ?').bind(is_locked ? 1 : 0, id).run();
  return c.json({ success: true, message: is_locked ? '帖子已锁定' : '帖子已解锁' });
});

// ===== 评论管理 =====

admin.get('/comments', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(parseInt(c.req.query('pageSize') || '20'), 50);
  const offset = (page - 1) * pageSize;
  const search = c.req.query('search') || '';
  const postId = c.req.query('postId') ? parseInt(c.req.query('postId')!) : undefined;

  let where = 'WHERE c.deleted_at IS NULL';
  const params: any[] = [];
  if (search) { where += " AND (c.content LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')"; params.push(`%${escapeLike(search)}%`, `%${escapeLike(search)}%`); }
  if (postId) { where += ' AND c.post_id = ?'; params.push(postId); }

  const total = await c.env.DB
    .prepare(`SELECT COUNT(*) as cnt FROM comments c LEFT JOIN users u ON c.user_id = u.id ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();

  const list = await c.env.DB
    .prepare(`
      SELECT c.id, c.post_id, c.user_id, u.username, u.role,
             substr(c.content, 1, 100) as content_preview, c.like_count, c.created_at
      FROM comments c LEFT JOIN users u ON c.user_id = u.id
      ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?
    `)
    .bind(...params, pageSize, offset)
    .all();

  return c.json({ success: true, data: list.results, total: total?.cnt || 0, page, pageSize });
});

// 删除评论（仅管理员；巡查员不可直接删）
admin.delete('/comments/:id', requireAdminRole, async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的ID' }, 400);
  await hardDeleteComment(c.env.DB, id);
  return c.json({ success: true, message: '评论已删除' });
});

// ===== 用户搜索 =====

admin.get('/users/search', async (c) => {
  const q = c.req.query('q') || '';
  if (!q || q.length < 1) return c.json({ success: true, data: [] });

  const users = await c.env.DB
    .prepare(`
      SELECT id, username, email, role, created_at
      FROM users WHERE deleted_at IS NULL AND (username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
      LIMIT 20
    `)
    .bind(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`)
    .all();

  return c.json({ success: true, data: users.results });
});

// ===== 详细统计 =====

admin.get('/stats/detail', async (c) => {
  // UTC+8 日期（北京时间）
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const today = cst.toISOString().slice(0, 10);

  const [todayUsers, todayPosts, todayComments, catStats, topUsers] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE created_at LIKE ? AND deleted_at IS NULL").bind(`${today}%`).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM posts WHERE created_at LIKE ? AND deleted_at IS NULL").bind(`${today}%`).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM comments WHERE created_at LIKE ? AND deleted_at IS NULL").bind(`${today}%`).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT c.name, COUNT(p.id) as count FROM categories c LEFT JOIN posts p ON c.id = p.category_id AND p.deleted_at IS NULL GROUP BY c.id ORDER BY count DESC").all(),
    c.env.DB.prepare("SELECT u.id, u.username, b.coins FROM user_balances b JOIN users u ON b.user_id = u.id WHERE u.deleted_at IS NULL ORDER BY b.coins DESC LIMIT 10").all(),
  ]);

  return c.json({
    success: true,
    data: {
      today: { users: todayUsers?.cnt || 0, posts: todayPosts?.cnt || 0, comments: todayComments?.cnt || 0 },
      categories: catStats.results,
      topUsers: topUsers.results,
    },
  });
});

// ===== 举报审核 =====

// 确认违规：软删帖子/评论 + 标记举报已处理 + 扣作者积分（金额可配）+ 通知作者 + 奖励举报人
// （多人复核达阈值或管理员一票时执行；软删帖由 cron 按 soft_delete_retention_days 到期硬删）
async function resolveReportTarget(db: D1Database, reportId: number): Promise<{ message: string } | { error: string; status: number }> {
  const report = await db
    .prepare("SELECT r.*, p.user_id as post_author_id, c.user_id as comment_author_id FROM reports r LEFT JOIN posts p ON r.target_type = 'post' AND r.target_id = p.id AND p.deleted_at IS NULL LEFT JOIN comments c ON r.target_type = 'comment' AND r.target_id = c.id AND c.deleted_at IS NULL WHERE r.id = ?")
    .bind(reportId)
    .first<{ target_type: string; target_id: number; reporter_id: number; post_author_id: number | null; comment_author_id: number | null }>();

  if (!report) return { error: '举报不存在', status: 404 };
  // 目标须存在且未软删（JOIN 已带 deleted_at IS NULL 守卫；软删帖的旧举报不再重复处罚，只清理）
  const targetExists = report.target_type === 'post' ? report.post_author_id !== null : report.comment_author_id !== null;
  if (!targetExists) {
    await db.batch([
      db.prepare("DELETE FROM reports WHERE target_id = ? AND target_type = ?").bind(report.target_id, report.target_type),
      // 轮次隔离：该目标的投票记录一并清理，管理员恢复后重新举报时巡查员可再次参与
      db.prepare("DELETE FROM report_review_actions WHERE target_type = ? AND target_id = ?").bind(report.target_type, report.target_id),
    ]);
    return { message: '举报目标已下架，已清理' };
  }

  const authorId = report.target_type === 'post' ? report.post_author_id : report.comment_author_id;
  const label = report.target_type === 'post' ? '帖子' : '评论';

  // 下架扣分金额（settings review_takedown_coins 可配，默认 50；帖子/评论统一）
  const deductMax = parseInt((await getSetting(db, 'review_takedown_coins')) || '') || 50;

  if (report.target_type === 'post') {
    // 帖子：软删（保留数据，30 天后 cron 硬删时再级联清理；期间管理员后台可见可恢复）
    await db.batch([
      db.prepare("UPDATE posts SET deleted_at = datetime('now') WHERE id = ?").bind(report.target_id),
      db.prepare('DELETE FROM reports WHERE target_id = ? AND target_type = ?').bind(report.target_id, 'post'),
      db.prepare("DELETE FROM reports WHERE target_id IN (SELECT id FROM comments WHERE post_id = ?) AND target_type = 'comment'").bind(report.target_id),
      // 轮次隔离：目标已处理，该目标的投票记录一并清理（管理员恢复后重新举报时巡查员可再次参与）
      db.prepare("DELETE FROM report_review_actions WHERE target_type = ? AND target_id = ?").bind('post', report.target_id),
    ]);
  } else {
    // 评论：软删评论及其子回复（comment_count 同步回退）
    const comment = await db.prepare('SELECT post_id FROM comments WHERE id = ?').bind(report.target_id).first<{ post_id: number }>();
    const childCount = await db.prepare('SELECT COUNT(*) as cnt FROM comments WHERE parent_id = ?').bind(report.target_id).first<{ cnt: number }>();
    const totalDeleted = 1 + (childCount?.cnt || 0);
    await db.batch([
      db.prepare("UPDATE comments SET deleted_at = datetime('now') WHERE id = ? OR parent_id = ?").bind(report.target_id, report.target_id),
      db.prepare('DELETE FROM reports WHERE target_id = ? AND target_type = ?').bind(report.target_id, 'comment'),
      // 轮次隔离：目标已处理，该目标的投票记录一并清理
      db.prepare("DELETE FROM report_review_actions WHERE target_type = ? AND target_id = ?").bind('comment', report.target_id),
    ]);
    if (comment) {
      await db.prepare("UPDATE posts SET comment_count = MAX(0, comment_count - ?) WHERE id = ?").bind(totalDeleted, comment.post_id).run();
    }
  }

  // 扣作者积分（下限 0）
  const userMsg = `已确认违规，${label}已下架并扣除作者 ${deductMax} 积分`;
  if (authorId) {
    const bal = await db
      .prepare('SELECT coins FROM user_balances WHERE user_id = ?')
      .bind(authorId)
      .first<{ coins: number }>();
    if (bal && bal.coins > 0) {
      const deductAmount = Math.min(deductMax, bal.coins);
      await db.batch([
        db.prepare('UPDATE user_balances SET coins = coins - ?, total_spent = total_spent + ? WHERE user_id = ?').bind(deductAmount, deductAmount, authorId),
        db.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'admin', ?, coins, ? FROM user_balances WHERE user_id = ?").bind(authorId, -deductAmount, `违规行为-违规${label}`, authorId),
      ]);
    }
    // 通知作者（评论举报时 reports.post_id 已回填所属帖子）
    // type=post_takedown：下架类通知（前端展开后可提供申诉入口）
    const postId = (report as any).post_id;
    if (postId) {
      await db.prepare("INSERT INTO notifications (user_id, type, post_id, content, read) VALUES (?, 'post_takedown', ?, ?, 0)")
        .bind(authorId, postId, `你的${label}因违规已被下架`)
        .run();
    }
  }

  // 举报有效处理：奖励举报人积分（settings report_reward_coins 可配，默认 10；仅确认违规分支，驳回不发）
  const rewardCoins = parseInt((await getSetting(db, 'report_reward_coins')) || '') || 10;
  await db.batch([
    db.prepare('INSERT INTO user_balances (user_id, coins, total_earned) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET coins = coins + ?, total_earned = total_earned + ?')
      .bind(report.reporter_id, rewardCoins, rewardCoins, rewardCoins, rewardCoins),
    db.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'report_reward', ?, coins, ? FROM user_balances WHERE user_id = ?")
      .bind(report.reporter_id, rewardCoins, '举报有效处理奖励', report.reporter_id),
  ]);

  // 写入新流水后立即收敛：每用户只保留最近 15 条
  if (authorId) await cleanupTransactions(db, authorId);
  await cleanupTransactions(db, report.reporter_id);

  return { message: userMsg };
}

// 驳回举报（不违规，删除该目标的所有待审核举报 + 该目标的投票记录，保证轮次隔离）
async function dismissReportTarget(db: D1Database, reportId: number): Promise<{ message: string }> {
  const r = await db.prepare("SELECT target_id, target_type FROM reports WHERE id = ?").bind(reportId).first<{ target_id: number; target_type: string }>();
  if (r) {
    await db.batch([
      db.prepare("DELETE FROM reports WHERE target_id = ? AND target_type = ?").bind(r.target_id, r.target_type),
      db.prepare("DELETE FROM report_review_actions WHERE target_type = ? AND target_id = ?").bind(r.target_type, r.target_id),
    ]);
  }
  return { message: '举报已全部驳回' };
}

// 待审核举报列表
admin.get('/reports', async (c) => {
  try {
    const user: JWTPayload | undefined = c.get('user');
    const myId = user?.userId || 0;
    const dbUser: User | undefined = c.get('dbUser');
    const isAdmin = dbUser?.role === 'admin';
    const page = Math.max(1, parseInt(c.req.query('page') || '1'));
    const pageSize = 20;
    const offset = (page - 1) * pageSize;

    // 隐藏规则：已投过票的巡查员不再看到该目标（管理员豁免，始终可见全部）
    const visibilityClause = isAdmin
      ? ''
      : " AND NOT EXISTS (SELECT 1 FROM report_review_actions rra WHERE rra.target_type = r.target_type AND rra.target_id = r.target_id AND rra.reviewer_id = ?)";
    const bindMyId = isAdmin ? [] : [myId];

    const total = await c.env.DB
      .prepare("SELECT COUNT(*) as cnt FROM reports r WHERE r.status = 'pending' AND r.target_id IS NOT NULL" + visibilityClause)
      .bind(...bindMyId)
      .first<{ cnt: number }>();

    const list = await c.env.DB
      .prepare(`
        SELECT r.id, r.post_id, r.target_type, r.target_id, r.reporter_id, r.reason, r.created_at,
               -- 多人复核票数（同一被举报内容共享票数）与我的投票
               (SELECT COUNT(*) FROM report_review_actions rra WHERE rra.target_type = r.target_type AND rra.target_id = r.target_id AND rra.action = 'confirm') AS confirm_count,
               (SELECT COUNT(*) FROM report_review_actions rra WHERE rra.target_type = r.target_type AND rra.target_id = r.target_id AND rra.action = 'pass') AS pass_count,
               (SELECT rra.action FROM report_review_actions rra WHERE rra.target_type = r.target_type AND rra.target_id = r.target_id AND rra.reviewer_id = ?) AS my_action,
               -- 帖子上下文（帖子举报 = 目标；评论举报 = 所属帖）
               p.title as post_title, p.content as post_content, p.is_anonymous as post_is_anonymous,
               p.user_id as post_user_id, pu.username as post_username, pu.avatar_url as post_avatar_url,
               cat.name as category_name,
               -- 评论上下文（评论举报 = 目标，含完整内容与作者）
               c.content as comment_content, c.created_at as comment_created_at, c.parent_id as comment_parent_id,
               cu.username as comment_username, cu.avatar_url as comment_avatar_url,
               -- 举报人
               u.username as reporter_name
        FROM reports r
        -- 帖子：帖子举报取 target_id，评论举报取回填的 post_id（reports.post_id 评论举报时已回填）
        LEFT JOIN posts p ON p.id = CASE WHEN r.target_type = 'post' THEN r.target_id ELSE r.post_id END
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN users pu ON p.user_id = pu.id
        LEFT JOIN comments c ON r.target_type = 'comment' AND r.target_id = c.id
        LEFT JOIN users cu ON c.user_id = cu.id
        LEFT JOIN users u ON r.reporter_id = u.id
        WHERE r.status = 'pending' AND r.target_id IS NOT NULL${visibilityClause}
        ORDER BY r.created_at ASC LIMIT ? OFFSET ?
      `)
      .bind(...bindMyId, myId, pageSize, offset)
      .all();

    // 评论举报：批量递归 CTE 一次取全部评论举报的祖先链（顶层 → 被举报评论），避免逐行查询 N+1
    const rows = (list.results || []) as any[];
    // 先收集所有需要加载祖先链的评论 target_id（保持列表顺序），没有则跳过批量查询
    const commentTargetIds = rows
      .filter((r) => r.target_type === 'comment' && r.target_id)
      .map((r) => r.target_id as number);
    if (commentTargetIds.length > 0) {
      // 单条 SQL 一次取所有链：占位符数量 = 评论举报数（≤ pageSize=20，远低于 D1 的 100 绑定参数上限），
      // CTE 携带 root_id 以便按根（被举报评论）分组
      const chain = await c.env.DB.prepare(`
        WITH RECURSIVE chain(root_id, id, parent_id, content, user_id, depth, created_at) AS (
          SELECT id, id, parent_id, content, user_id, 0, created_at FROM comments
          WHERE id IN (${commentTargetIds.map(() => '?').join(',')}) AND deleted_at IS NULL
          UNION ALL
          SELECT chain.root_id, c.id, c.parent_id, c.content, c.user_id, chain.depth + 1, c.created_at
          FROM comments c JOIN chain ON c.id = chain.parent_id
          WHERE c.deleted_at IS NULL
        )
        SELECT root_id, id, parent_id, content, user_id, depth, created_at FROM chain
        ORDER BY root_id, depth DESC
      `).bind(...commentTargetIds).all<{ root_id: number; id: number; parent_id: number | null; content: string; user_id: number; depth: number; created_at: string }>();
      // 按 root_id 分组（结果已按 root_id, depth DESC 排序，组内顶层祖先在前），再映射回各行
      const chainByRoot = new Map<number, any[]>();
      for (const cc of chain.results || []) {
        let arr = chainByRoot.get(cc.root_id);
        if (!arr) { arr = []; chainByRoot.set(cc.root_id, arr); }
        arr.push(cc);
      }
      for (const r of rows) {
        if (r.target_type !== 'comment' || !r.target_id) continue;
        r.comment_chain = (chainByRoot.get(r.target_id) || []).map((cc) => ({
          id: cc.id,
          parent_id: cc.parent_id,
          user_id: cc.user_id,
          content: cc.content,
          created_at: cc.created_at,
          // 前端统一匿名显示「用户一/用户二」等编号，不暴露真实身份
          is_target: cc.id === r.target_id,
        }));
      }
    }

    const vLimit = parseInt((await getSetting(c.env.DB, 'report_violation_limit')) || '') || 3;
    const pLimit = parseInt((await getSetting(c.env.DB, 'report_pass_limit')) || '') || 3;
    return c.json({ success: true, data: rows, total: total?.cnt || 0, page, pageSize, limit: vLimit, passLimit: pLimit, adminVeto: isAdmin });
  } catch { return c.json({ success: true, data: [], total: 0, page: 1, pageSize: 20 }); }
});

// 多人复核投票（仿帖子巡查）：confirm 达到 review_violation_limit 人确认违规 → 删除；
// pass 达到 review_pass_limit 人 → 驳回；管理员一票否决/一票通过
admin.post('/reports/:id/review', async (c) => {
  try {
    const user: JWTPayload | undefined = c.get('user');
    if (!user) return c.json({ success: false, error: '请先登录' }, 401);
    const reportId = parseId(c.req.param('id'));
    if (reportId === null) return c.json({ success: false, error: '无效的举报ID' }, 400);
    const { action } = await c.req.json();
    if (!['confirm', 'pass'].includes(action)) return c.json({ success: false, error: '参数无效' }, 400);

    const report = await c.env.DB
      .prepare('SELECT target_type, target_id, reporter_id FROM reports WHERE id = ?')
      .bind(reportId)
      .first<{ target_type: string; target_id: number; reporter_id: number }>();
    if (!report) return c.json({ success: false, error: '举报不存在' }, 404);

    // 投票幂等覆盖（UNIQUE(target_type, target_id, reviewer_id)）
    await c.env.DB.prepare(`INSERT INTO report_review_actions (target_type, target_id, reviewer_id, action) VALUES (?, ?, ?, ?)
      ON CONFLICT(target_type, target_id, reviewer_id) DO UPDATE SET action = excluded.action, created_at = datetime('now')`)
      .bind(report.target_type, report.target_id, user.userId, action).run();

    const dbUser: User | undefined = c.get('dbUser');
    const isAdmin = dbUser?.role === 'admin';

    // 幂等抢占：真正执行下架/驳回前先把举报置为 resolved（仅 pending 可抢占），
    // 防两名巡查员并发达阈值导致双扣分/双奖励/双通知；抢不到说明已被并发处理
    const claimResolved = async (): Promise<boolean> => {
      const claimed = await c.env.DB.prepare("UPDATE reports SET status = 'resolved' WHERE id = ? AND status = 'pending'").bind(reportId).run();
      return !!claimed.meta.changes;
    };

    // 管理员一票否决/一票通过（与帖子巡查一致）
    if (isAdmin) {
      if (!(await claimResolved())) return c.json({ success: false, error: '该举报已处理' }, 409);
      if (action === 'confirm') {
        const r = await resolveReportTarget(c.env.DB, reportId);
        if ('error' in r) return c.json({ success: false, error: r.error }, r.status);
        return c.json({ success: true, message: '管理员已确认违规，' + r.message });
      }
      await dismissReportTarget(c.env.DB, reportId);
      return c.json({ success: true, message: '管理员已驳回举报' });
    }

    // 普通巡查员：双计数竞争（同一目标的所有举报共享票数）——违规优先，先到阈值者生效
    const confirmCnt = (await c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM report_review_actions WHERE target_type = ? AND target_id = ? AND action = 'confirm'`)
      .bind(report.target_type, report.target_id).first<{ cnt: number }>())?.cnt || 0;
    const passCnt = (await c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM report_review_actions WHERE target_type = ? AND target_id = ? AND action = 'pass'`)
      .bind(report.target_type, report.target_id).first<{ cnt: number }>())?.cnt || 0;

    const vLimit = parseInt((await getSetting(c.env.DB, 'report_violation_limit')) || '') || 3;
    const pLimit = parseInt((await getSetting(c.env.DB, 'report_pass_limit')) || '') || 3;

    // 违规优先：同时达标（理论极小概率）按确认违规处理
    if (confirmCnt >= vLimit) {
      if (!(await claimResolved())) return c.json({ success: false, error: '该举报已处理' }, 409);
      const r = await resolveReportTarget(c.env.DB, reportId);
      if ('error' in r) return c.json({ success: false, error: r.error }, r.status);
      return c.json({ success: true, message: `已确认违规（${confirmCnt}/${vLimit} 人），${r.message}`, confirm_count: confirmCnt, limit: vLimit });
    }
    if (passCnt >= pLimit) {
      if (!(await claimResolved())) return c.json({ success: false, error: '该举报已处理' }, 409);
      await dismissReportTarget(c.env.DB, reportId);
      return c.json({ success: true, message: `已驳回（${passCnt}/${pLimit} 人确认没问题）`, pass_count: passCnt, pass_limit: pLimit });
    }
    if (action === 'confirm') {
      return c.json({ success: true, message: `已确认违规（${confirmCnt}/${vLimit} 人），还需 ${vLimit - confirmCnt} 人确认`, confirm_count: confirmCnt, limit: vLimit });
    }
    return c.json({ success: true, message: `已投「没问题」（${passCnt}/${pLimit} 人），还需 ${pLimit - passCnt} 人`, pass_count: passCnt, pass_limit: pLimit });
  } catch (err: any) {
    return c.json({ success: false, error: '操作失败' }, 500);
  }
});

// 确认违规：删除帖子 + 标记举报已处理 + 扣发帖人 50 积分
// ⚠️ 仅管理员可用：直接删除绕过多人复核，moderator 必须走 /reports/:id/review 投票（3 票制）
admin.post('/reports/:id/resolve', async (c) => {
  try {
    const dbUser: User | undefined = c.get('dbUser');
    if (dbUser?.role !== 'admin') return c.json({ success: false, error: '仅管理员可直接删除，巡查员请走多人复核投票' }, 403);
    const reportId = parseId(c.req.param('id'));
    if (reportId === null) return c.json({ success: false, error: '无效的举报ID' }, 400);
    const r = await resolveReportTarget(c.env.DB, reportId);
    if ('error' in r) return c.json({ success: false, error: r.error }, r.status);
    return c.json({ success: true, message: r.message });
  } catch (err: any) {
    return c.json({ success: false, error: '处理失败' }, 500);
  }
});

// 驳回举报（不违规，删除该目标的所有待审核举报）
// ⚠️ 仅管理员可用：moderator 必须走 /reports/:id/review 投票
admin.post('/reports/:id/dismiss', async (c) => {
  try {
    const dbUser: User | undefined = c.get('dbUser');
    if (dbUser?.role !== 'admin') return c.json({ success: false, error: '仅管理员可驳回，巡查员请走多人复核投票' }, 403);
    const reportId = parseId(c.req.param('id'));
    if (reportId === null) return c.json({ success: false, error: '无效的举报ID' }, 400);
    const r = await dismissReportTarget(c.env.DB, reportId);
    return c.json({ success: true, message: r.message });
  } catch (err: any) {
    return c.json({ success: false, error: '操作失败' }, 500);
  }
});

// ===== 解封自赎审核 =====

admin.get('/unban-requests', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const total = await c.env.DB
    .prepare("SELECT COUNT(*) as cnt FROM unban_requests WHERE status = 'pending'")
    .first<{ cnt: number }>();

  const list = await c.env.DB
    .prepare(`
      SELECT ur.*, u.username, u.email, u.avatar_url, u.banned_until, u.ban_reason
      FROM unban_requests ur
      JOIN users u ON ur.user_id = u.id
      WHERE ur.status = 'pending'
      ORDER BY ur.created_at ASC
      LIMIT ? OFFSET ?
    `)
    .bind(pageSize, offset)
    .all();

  return c.json({ success: true, data: list.results, total: total?.cnt || 0, page, pageSize });
});

// 通过解封
admin.post('/unban-requests/:id/approve', async (c) => {
  try {
    const adminUser: JWTPayload = c.get('user');
    const requestId = parseId(c.req.param('id'));
    if (requestId === null) return c.json({ success: false, error: '无效的ID' }, 400);

    const request = await c.env.DB
      .prepare("SELECT * FROM unban_requests WHERE id = ? AND status = 'pending'")
      .bind(requestId)
      .first<any>();
    if (!request) return c.json({ success: false, error: '申请不存在或已处理' }, 404);

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET banned_until = NULL WHERE id = ?').bind(request.user_id),
      c.env.DB.prepare("UPDATE unban_requests SET status = ?, reviewer_id = ?, reviewed_at = datetime('now') WHERE id = ?")
        .bind('approved', adminUser.userId, requestId),
    ]);

    await createNotification(c.env.DB, request.user_id, adminUser.userId, 'system', undefined, undefined, '你的解封申请已通过，账户已解封').catch(() => {});
    return c.json({ success: true, message: '已通过解封申请，用户已解封' });
  } catch (err: any) {
    console.error('[admin] approve unban error:', err);
    return c.json({ success: false, error: '操作失败' }, 500);
  }
});

// 驳回解封（退款）
admin.post('/unban-requests/:id/reject', async (c) => {
  try {
    const adminUser: JWTPayload = c.get('user');
    const requestId = parseId(c.req.param('id'));
    if (requestId === null) return c.json({ success: false, error: '无效的ID' }, 400);

    const { reason } = await c.req.json();
    const request = await c.env.DB
      .prepare("SELECT * FROM unban_requests WHERE id = ? AND status = 'pending'")
      .bind(requestId)
      .first<any>();
    if (!request) return c.json({ success: false, error: '申请不存在或已处理' }, 404);

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?')
        .bind(request.coins_paid, request.coins_paid, request.user_id),
      c.env.DB.prepare("UPDATE unban_requests SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = datetime('now') WHERE id = ?")
        .bind('rejected', adminUser.userId, reason || '未通过审核', requestId),
      c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'unban_refund', ?, coins, ? FROM user_balances WHERE user_id = ?")
        .bind(request.user_id, request.coins_paid, `解封申请驳回退款：${reason || '未通过审核'}`, request.user_id),
    ]);
    // 写入新流水后立即收敛：每用户只保留最近 15 条
    await cleanupTransactions(c.env.DB, request.user_id);

    await createNotification(c.env.DB, request.user_id, adminUser.userId, 'system', undefined, undefined,
      `你的解封申请未通过审核${reason ? `，原因：${reason}` : ''}，${request.coins_paid} 积分已退还`).catch(() => {});
    return c.json({ success: true, message: '已驳回申请，积分已退还' });
  } catch (err: any) {
    console.error('[admin] reject unban error:', err);
    return c.json({ success: false, error: '操作失败' }, 500);
  }
});

// ===== 抽奖管理 =====

admin.get('/lottery', async (c) => {
  try {
    const prizes = await c.env.DB.prepare('SELECT * FROM lottery_coin_prizes ORDER BY rarity DESC, id ASC').all();
    const totalPulls = await c.env.DB.prepare('SELECT SUM(total_pulls) as pulls FROM lottery_pity').first<{ pulls: number }>();
    const topPity = await c.env.DB.prepare(`
      SELECT lp.user_id, u.username, lp.pulls_since_ssr, lp.total_pulls
      FROM lottery_pity lp JOIN users u ON lp.user_id = u.id
      ORDER BY lp.pulls_since_ssr DESC LIMIT 10
    `).all();
    // 抽奖配置（后台可改的全部数值）
    const cfgKeys = ['lottery_draw_cost', 'lottery_draw10_cost', 'lottery_rate_ssr', 'lottery_rate_ssr_boost',
      'lottery_rate_sr', 'lottery_rate_r', 'lottery_rate_n', 'lottery_pity_soft', 'lottery_pity_hard'];
    const cfgRows = await c.env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${cfgKeys.map(() => '?').join(',')})`).bind(...cfgKeys).all<{ key: string; value: string }>();
    const config: Record<string, string> = {};
    for (const r of cfgRows.results || []) config[r.key] = r.value;
    return c.json({ success: true, data: { prizes: prizes.results, totalPulls: totalPulls?.pulls || 0, topPity: topPity.results, config } });
  } catch { return c.json({ success: true, data: { prizes: [], totalPulls: 0, topPity: [], config: {} } }); }
});

// 保存抽奖配置（价格/概率/保底，全部可改）
admin.put('/lottery', async (c) => {
  try {
    const body = await c.req.json();
    const allowed: Record<string, number> = {
      lottery_draw_cost: 1, lottery_draw10_cost: 1,
      lottery_rate_ssr: 0, lottery_rate_ssr_boost: 0, lottery_rate_sr: 0, lottery_rate_r: 0, lottery_rate_n: 0,
      lottery_pity_soft: 1, lottery_pity_hard: 1,
    };
    const updates: { key: string; value: string }[] = [];
    for (const [key, min] of Object.entries(allowed)) {
      if (body[key] === undefined) continue;
      const v = parseInt(String(body[key]));
      if (!Number.isFinite(v) || v < min || v > 10000) {
        return c.json({ success: false, error: `配置项 ${key} 必须是不小于 ${min} 的整数` }, 400);
      }
      updates.push({ key, value: String(v) });
    }
    if (updates.length === 0) return c.json({ success: false, error: '没有可保存的配置项' }, 400);
    // 软保底必须小于硬保底（基于最终值：未提交的一侧取库中现值）
    const parse = (u?: { key: string; value: string }) => u ? parseInt(u.value) : undefined;
    let softV = parse(updates.find(u => u.key === 'lottery_pity_soft'));
    let hardV = parse(updates.find(u => u.key === 'lottery_pity_hard'));
    if (softV === undefined || hardV === undefined) {
      const cur = await c.env.DB.prepare(
        `SELECT key, value FROM settings WHERE key IN ('lottery_pity_soft','lottery_pity_hard')`
      ).all<{ key: string; value: string }>();
      const curMap: Record<string, string> = {};
      for (const r of cur.results || []) curMap[r.key] = r.value;
      if (softV === undefined) softV = parseInt(curMap.lottery_pity_soft ?? '50');
      if (hardV === undefined) hardV = parseInt(curMap.lottery_pity_hard ?? '80');
    }
    if (softV >= hardV) {
      return c.json({ success: false, error: '软保底抽数必须小于硬保底抽数' }, 400);
    }
    await c.env.DB.batch(updates.map(u =>
      c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(u.key, u.value)
    ));
    return c.json({ success: true, message: '抽奖配置已保存' });
  } catch { return c.json({ success: false, error: '保存失败' }, 500); }
});

// 新增奖品
admin.post('/lottery/prizes', async (c) => {
  try {
    const { name, emoji, type, value, weight, rarity } = await c.req.json();
    if (!name || !type) return c.json({ success: false, error: '名称和类型必填' }, 400);
    const rarityOk = ['N', 'R', 'SR', 'SSR'].includes(rarity || '');
    if (!rarityOk) return c.json({ success: false, error: '稀有度必须是 N/R/SR/SSR' }, 400);
    const w = parseInt(String(weight ?? 1));
    if (!Number.isFinite(w) || w < 1) return c.json({ success: false, error: '权重必须是不小于 1 的整数' }, 400);
    const row = await c.env.DB.prepare(
      'INSERT INTO lottery_coin_prizes (name, emoji, type, value, weight, rarity) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
    ).bind(String(name), String(emoji || ''), String(type), String(value ?? ''), w, rarity).first<{ id: number }>();
    return c.json({ success: true, data: row, message: '奖品已添加' }, 201);
  } catch { return c.json({ success: false, error: '添加失败' }, 500); }
});

// 编辑奖品
admin.put('/lottery/prizes/:id', async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (id === null) return c.json({ success: false, error: '无效的奖品ID' }, 400);
    const { name, emoji, type, value, weight, rarity } = await c.req.json();
    const sets: string[] = []; const vals: any[] = [];
    if (name !== undefined) { sets.push('name = ?'); vals.push(String(name)); }
    if (emoji !== undefined) { sets.push('emoji = ?'); vals.push(String(emoji)); }
    if (type !== undefined) { sets.push('type = ?'); vals.push(String(type)); }
    if (value !== undefined) { sets.push('value = ?'); vals.push(String(value)); }
    if (weight !== undefined) {
      const w = parseInt(String(weight));
      if (!Number.isFinite(w) || w < 1) return c.json({ success: false, error: '权重必须是不小于 1 的整数' }, 400);
      sets.push('weight = ?'); vals.push(w);
    }
    if (rarity !== undefined) {
      if (!['N', 'R', 'SR', 'SSR'].includes(rarity)) return c.json({ success: false, error: '稀有度必须是 N/R/SR/SSR' }, 400);
      sets.push('rarity = ?'); vals.push(rarity);
    }
    if (sets.length === 0) return c.json({ success: false, error: '没有可更新的字段' }, 400);
    await c.env.DB.prepare(`UPDATE lottery_coin_prizes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
    return c.json({ success: true, message: '奖品已更新' });
  } catch { return c.json({ success: false, error: '更新失败' }, 500); }
});

// 删除奖品
admin.delete('/lottery/prizes/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的奖品ID' }, 400);
  await c.env.DB.prepare('DELETE FROM lottery_coin_prizes WHERE id = ?').bind(id).run();
  return c.json({ success: true, message: '奖品已删除' });
});

// ===== 邀请码管理 =====

admin.get('/invites', requireAuth, requireAdmin, async (c) => {
  try {
    // 注意：不删除已使用的邀请码——用户侧邀请统计（/auth/invites）按 invite_codes.used_by 计数，
    // 删掉会导致统计缩水；列表查询已按 used_by IS NULL 过滤，保留不影响展示
    const codes = await c.env.DB.prepare(`
      SELECT ic.*, creator.username as creator_name
      FROM invite_codes ic
      LEFT JOIN users creator ON ic.created_by = creator.id
      WHERE ic.used_by IS NULL
      ORDER BY ic.created_at DESC
    `).all();
    return c.json({ success: true, data: codes.results || [] });
  } catch (err: any) {
    return c.json({ success: false, error: '获取失败' }, 500);
  }
});

admin.post('/invites', requireAuth, requireAdmin, async (c) => {
  try {
    // ponytail: requireAuth + requireAdmin 已确保 dbUser 存在
    const dbUser: any = c.get('dbUser');
    const userId = dbUser.id;
    // 生成随机 8 字符邀请码（字母数字）
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉了易混淆的 0/O/1/I
    let code = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      code = '';
      const buf = new Uint8Array(8);
      crypto.getRandomValues(buf);
      for (let i = 0; i < 8; i++) {
        code += chars[buf[i] % chars.length];
      }
      // 检查唯一性
      const existing = await c.env.DB
        .prepare('SELECT code FROM invite_codes WHERE code = ?')
        .bind(code).first();
      if (!existing) break;
      code = ''; // 冲突则重试
    }
    if (!code) {
      return c.json({ success: false, error: '生成失败，请重试' }, 500);
    }
    await c.env.DB
      .prepare('INSERT INTO invite_codes (code, created_by) VALUES (?, ?)')
      .bind(code, userId).run();
    return c.json({ success: true, data: { code }, message: '邀请码已生成' });
  } catch (err: any) {
    console.error('[invites] generate error:', err);
    return c.json({ success: false, error: `生成失败: ${err.message}` }, 500);
  }
});

// 删除邀请码（未使用/已使用均可删，仅管理员）
admin.delete('/invites/:code', requireAdminRole, async (c) => {
  const code = c.req.param('code');
  if (!code) return c.json({ success: false, error: '无效的邀请码' }, 400);
  const res = await c.env.DB.prepare('DELETE FROM invite_codes WHERE code = ?').bind(code).run();
  if (!res.meta.changes) return c.json({ success: false, error: '邀请码不存在' }, 404);
  return c.json({ success: true, message: '邀请码已删除' });
});

export default admin;
