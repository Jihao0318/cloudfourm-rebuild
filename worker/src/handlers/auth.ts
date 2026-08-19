import { Hono } from 'hono';
import type { Env, JWTPayload, User } from '../types';
import { createToken, createRefreshToken, hashRefreshToken } from '../utils/jwt';
import { hashPassword, verifyPassword } from '../utils/password';
import { validateUsername, validateEmail, validatePassword } from '../utils/validation';
import { requireAuth, cleanupUser } from '../middleware/auth';
import { sendMail } from '../utils/mailer';
import { cleanupTransactions } from './coins';
import { todayUtc8 } from '../utils/game';
import {
  getUserByEmail,
  getUserByUsername,
  getUserByEmailOrUsername,
  createUser,
  verifyUserEmail,
  updateUser,
  getUserById,
  createVerification,
  verifyCode,
} from '../db/queries';

const auth = new Hono<{ Bindings: Env }>();

// 会话持久策略：refresh token 有效期 90 天，每次自动续签（轮换）时重置为 90 天——
// 即「滑动续期」：活跃用户（90 天内使用过）永远无需重新登录；
// 不活跃超过 90 天后 refresh token 过期，需重新登录。access token 仍为 7 天（前端 401 自动刷新，无感）。
// 安全性与 7 天版一致：轮换制 + 重放检测 + 仅存哈希 + 登出/改密/改邮箱全量吊销均保留。
const REFRESH_TOKEN_TTL_DAYS = 90;

// 邀请奖励每日上限（次/天）：防止「生成邀请码→注册马甲→主号拿奖励」无限自刷。
// 当前写死 20 次，后续可改为 settings 配置项（如 invite_reward_daily_limit）
const DAILY_INVITE_REWARD_LIMIT = 20;

// 生成并存储 refresh token
async function generateAndStoreRefreshToken(db: D1Database, userId: number): Promise<string> {
  const rt = createRefreshToken();
  const hash = await hashRefreshToken(rt);
  const expires = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').bind(userId, hash, expires).run()
    .catch((err) => { console.error('Failed to store refresh token:', err); });
  return rt;
}

// 需要登录的路由组
auth.use('/me', requireAuth);

// 注册
auth.post('/register', async (c) => {
  const { username, email, password, invite_code } = await c.req.json();
  // 邮箱统一小写（与 forgot/reset/改邮箱流程的 lowercase 口径一致，避免 Foo@qq.com 注册后无法登录）
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : email;

  // 站点开关：registration_enabled = 0 时关闭注册（后台可配，未设置视为开启）
  const regCfg = await c.env.DB
    .prepare("SELECT value FROM settings WHERE key = 'registration_enabled'")
    .first<{ value: string }>();
  if (regCfg && regCfg.value === '0') {
    return c.json({ success: false, error: '注册已关闭' }, 400);
  }

  // 验证输入
  const usernameCheck = validateUsername(username);
  if (!usernameCheck.valid) return c.json({ success: false, error: usernameCheck.error }, 400);
  const emailCheck = validateEmail(normalizedEmail);
  if (!emailCheck.valid) return c.json({ success: false, error: emailCheck.error }, 400);
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) return c.json({ success: false, error: passwordCheck.error }, 400);

  // 检查是否已注册（合并为一次查询）
  const existing = await getUserByEmailOrUsername(c.env.DB, normalizedEmail, username);
  if (existing.emailExists) return c.json({ success: false, error: '该邮箱已被注册' }, 409);
  if (existing.usernameExists) return c.json({ success: false, error: '该用户名已被使用' }, 409);

  // 邀请码校验：已有管理员时注册必须使用邀请码
  const adminCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").first<{ count: number }>();
  const hasAdmin = adminCount && adminCount.count > 0;

  if (hasAdmin) {
    if (!invite_code) {
      return c.json({ success: false, error: '注册需要邀请码' }, 400);
    }
    // 校验邀请码存在且未使用（并发安全由下方原子占码保证，此处仅用于错误提示区分）
    const invite = await c.env.DB
      .prepare('SELECT code FROM invite_codes WHERE code = ? AND used_by IS NULL')
      .bind(invite_code).first();
    if (!invite) {
      return c.json({ success: false, error: '邀请码无效或已使用' }, 400);
    }
  }

  // 创建用户（先建用户拿到真实 id，原子占码用真实 id——used_by 有 FK 指向 users，不能用 -1 占位）
  const passwordHash = await hashPassword(password);
  const user = await createUser(c.env.DB, username, normalizedEmail, passwordHash);
  if (!user) {
    return c.json({ success: false, error: '注册失败，请重试' }, 500);
  }

  // 初始化积分账户：新用户注册即建 user_balances 行（初始积分后台可配 default_user_coins，默认 200）。
  // 此前只有 GET /coins/balance 懒创建，导致邀请奖励/抢红包/任务等入账路径 UPDATE 0 行静默丢分
  const initCfg = await c.env.DB
    .prepare("SELECT value FROM settings WHERE key = 'default_user_coins'")
    .first<{ value: string }>();
  const parsedInit = parseInt(initCfg?.value || '', 10);
  const startCoins = Number.isFinite(parsedInit) && parsedInit >= 0 ? parsedInit : 200;
  await c.env.DB
    .prepare('INSERT INTO user_balances (user_id, coins, total_earned) VALUES (?, ?, ?)')
    .bind(user.id, startCoins, startCoins)
    .run();

  // 审计：记录注册来源 IP（CF-Connecting-IP 为 Cloudflare 回源真实 IP；本地开发回退 X-Forwarded-For）
  await c.env.DB
    .prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'register', ?)")
    .bind(user.id, 'ip=' + (c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'))
    .run()
    .catch(() => {});

  // 原子占码：UPDATE 成功才继续；失败（并发被抢）→ 删除刚创建的用户回滚
  if (hasAdmin) {
    const claim = await c.env.DB
      .prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE code = ? AND used_by IS NULL")
      .bind(user.id, invite_code).run();
    if (!claim.meta.changes) {
      // 回滚刚创建的用户：先删 user_balances（FK 无级联），再删用户，避免外键约束报错
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM user_balances WHERE user_id = ?').bind(user.id),
        c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
      ]);
      return c.json({ success: false, error: '邀请码已被使用' }, 400);
    }

    // 邀请奖励：邀请者 +N 积分（settings invite_reward_coins 可配，默认 120——拉新属高质量行为，奖励≈4 天任务量，1 个邀请码上限仍约束刷分）
    const inviter = await c.env.DB
      .prepare('SELECT created_by FROM invite_codes WHERE code = ?')
      .bind(invite_code)
      .first<{ created_by: number }>();
    if (inviter && inviter.created_by && inviter.created_by !== user.id) {
      const cfg = await c.env.DB
        .prepare("SELECT value FROM settings WHERE key = 'invite_reward_coins'")
        .first<{ value: string }>();
      const reward = parseInt(cfg?.value || '120', 10) || 120;
      // 防刷：邀请者每日 invite_reward 奖励次数上限（todayUtc8 为 UTC+8 业务日口径，与每日任务一致）。
      // 超限只跳过发奖，注册流程不受影响（避免「生成邀请码→注册马甲→主号拿奖」无限自刷）
      const todayInviteRewards = await c.env.DB
        .prepare("SELECT COUNT(*) as c FROM coin_transactions WHERE user_id = ? AND type = 'invite_reward' AND created_at LIKE ?")
        .bind(inviter.created_by, `${todayUtc8()}%`)
        .first<{ c: number }>();
      if ((todayInviteRewards?.c || 0) < DAILY_INVITE_REWARD_LIMIT) {
        await c.env.DB.batch([
          c.env.DB.prepare('UPDATE user_balances SET coins = coins + ?, total_earned = total_earned + ? WHERE user_id = ?')
            .bind(reward, reward, inviter.created_by),
          c.env.DB.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'invite_reward', ?, coins, ? FROM user_balances WHERE user_id = ?")
            .bind(inviter.created_by, reward, `邀请奖励：新用户注册成功`, inviter.created_by),
        ]);
        // 写入新流水后立即收敛：每用户只保留最近 15 条
        await cleanupTransactions(c.env.DB, inviter.created_by);
      }
    }
  }

  // 初始管理员提权：
  // - 配置了 INITIAL_ADMIN_EMAIL：仅邮箱匹配者提权 admin（防抢注）
  // - 未配置（本地开发兼容）：保持旧逻辑——首个注册用户自动 admin
  // ⚠️ 上线前必须在 wrangler.jsonc / CI secrets 设置 INITIAL_ADMIN_EMAIL，否则存在抢注风险
  const isInitialAdmin = c.env.INITIAL_ADMIN_EMAIL
    ? normalizedEmail === c.env.INITIAL_ADMIN_EMAIL
    : !!(adminCount && adminCount.count === 0);
  if (isInitialAdmin) {
    await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind('admin', user.id).run();
    user.role = 'admin';
  }

  // 生成邮箱验证码并发送（注册后 email_verified=0，须在资料页验证；失败仅日志，不阻塞注册）
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  const emailCode = Array.from(buf).map((b) => b % 10).join('');
  await createVerification(c.env.DB, user.id, 'email_verify', emailCode, 60);
  const mailRes = await sendMail(c, {
    to: user.email,
    subject: '【CloudForum】邮箱验证',
    text: `你的验证码是：${emailCode}\n60 分钟内有效，请勿泄露给他人。如果不是你本人注册，请忽略本邮件。`,
    fromName: 'CloudForum',
  });
  if (!mailRes.ok) {
    console.error('[register] 验证码邮件发送失败:', mailRes.error);
  }

  // 新用户礼包：出生自带 2 张匿名卡（user_lottery_items，可用于匿名发帖）
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO user_lottery_items (user_id, item_type, item_name) VALUES (?, 'item_anonymous_card', '匿名卡')").bind(user.id),
    c.env.DB.prepare("INSERT INTO user_lottery_items (user_id, item_type, item_name) VALUES (?, 'item_anonymous_card', '匿名卡')").bind(user.id),
  ]);

  // 新注册用户无 VIP，无需查库；payload 只含身份 + ver（role/vip 一律从 dbUser 读）
  const token = await createToken(
    { userId: user.id, username: user.username, ver: user.token_version },
    c.env.JWT_SECRET
  );
  const refresh_token = await generateAndStoreRefreshToken(c.env.DB, user.id);

  return c.json({
    success: true,
    data: {
      token,
      refresh_token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role, email_verified: 0 },
    },
    message: '注册成功',
  });
});

// 登录失败计数：fail_count >= 10 锁 30 分钟，>= 5 锁 15 分钟；锁定时清零，到期后重新计数
// 锁定时长加入随机抖动（±5 分钟），避免攻击者按固定节奏循环锁号（DoS 缓解）
async function recordLoginFailure(db: D1Database, userId: number): Promise<void> {
  await db.prepare(
    'INSERT INTO login_attempts (user_id, fail_count, locked_until) VALUES (?, 1, NULL) ON CONFLICT(user_id) DO UPDATE SET fail_count = fail_count + 1'
  ).bind(userId).run();
  const attempts = await db.prepare('SELECT fail_count FROM login_attempts WHERE user_id = ?').bind(userId).first<{ fail_count: number }>();
  const count = attempts?.fail_count || 1;
  const jitter = (crypto.getRandomValues(new Uint32Array(1))[0] % 10); // 锁定时长随机抖动，防固定节奏循环锁号
  if (count >= 10) {
    await db.prepare(`UPDATE login_attempts SET locked_until = datetime('now', '+${30 + jitter} minutes'), fail_count = 0 WHERE user_id = ?`).bind(userId).run();
  } else if (count >= 5) {
    await db.prepare(`UPDATE login_attempts SET locked_until = datetime('now', '+${15 + jitter} minutes'), fail_count = 0 WHERE user_id = ?`).bind(userId).run();
  }
}

// 登录
auth.post('/login', async (c) => {
  const body = await c.req.json();
  const { password } = body;
  // 兼容 email 和 login 字段名，支持用户名或邮箱
  const loginField = body.email || body.login || '';

  // 查出用户（payload 已不含 vip，无需 JOIN user_vips）
  const loginFieldName = loginField.includes('@') ? 'email' : 'username';
  const row = await c.env.DB
    .prepare(`SELECT * FROM users WHERE ${loginFieldName} = ? AND deleted_at IS NULL`)
    .bind(loginField)
    .first<any>();

  // 账号锁定检查（校验密码前）：用户不存在时查 0 桶——锁 0 桶可拦所有未知账号爆破
  const lockUserId = row ? row.id : 0;
  const locked = await c.env.DB
    .prepare("SELECT locked_until FROM login_attempts WHERE user_id = ? AND locked_until > datetime('now')")
    .bind(lockUserId)
    .first<{ locked_until: string }>();
  if (locked) {
    return c.json({ success: false, error: '尝试次数过多，请稍后再试' }, 429);
  }

  if (!row) {
    // 用户不存在：统一报错防枚举，失败计入 0 桶
    await recordLoginFailure(c.env.DB, 0);
    return c.json({ success: false, error: '账号或密码错误' }, 401);
  }

  const pwResult = await verifyPassword(password, row.password_hash);
  if (!pwResult.valid) {
    await recordLoginFailure(c.env.DB, row.id);
    return c.json({ success: false, error: '账号或密码错误' }, 401);
  }

  // 邮箱强验证：settings email_verification_required = 1 时，未验证邮箱的账号禁止登录（注册后必须验证）
  // 兼容历史键名 require_email_verify（000/001 迁移写入的旧键）
  const verifyCfg = await c.env.DB
    .prepare("SELECT value FROM settings WHERE key IN ('email_verification_required', 'require_email_verify') LIMIT 1")
    .first<{ value: string }>();
  if (verifyCfg && (verifyCfg.value === '1' || verifyCfg.value === 'true') && !row.email_verified) {
    return c.json({ success: false, error: '邮箱未验证，请先在登录前完成邮箱验证' }, 403);
  }

  // 登录成功：清空该用户与 0 桶的失败计数
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE user_id IN (0, ?)').bind(row.id).run();

  // 旧版 bcrypt 哈希验证通过后升级为 PBKDF2
  if (pwResult.needsUpgrade) {
    try {
      const newHash = await hashPassword(password);
      await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, row.id).run();
    } catch {} // 升级失败不影响登录
  }

  // payload 只含身份 + ver（role/vip 一律从 dbUser 读）
  const token = await createToken(
    { userId: row.id, username: row.username, ver: row.token_version },
    c.env.JWT_SECRET
  );
  const refresh_token = await generateAndStoreRefreshToken(c.env.DB, row.id);

  return c.json({
    success: true,
    data: {
      token,
      refresh_token,
      user: { id: row.id, username: row.username, email: row.email, role: row.role, avatar_url: row.avatar_url, scheduled_deleted_at: row.scheduled_deleted_at, custom_title: row.custom_title, nick_theme: row.nick_theme },
    },
  });
});

// 管理员状态验证（从 DB 实时读取，绕过 JWT 缓存）
auth.get('/admin-status', requireAuth, async (c) => {
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

// ===== 修改密码（两步验证：旧密码 + 邮件验证码）=====

// 生成 6 位数字验证码（crypto 安全随机）
function generateSixDigitCode(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b % 10).join('');
}

// 第一步：验证旧密码，向注册邮箱发送验证码（10 分钟有效）
auth.post('/password/request', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { old_password } = await c.req.json().catch(() => ({}));

  const fullUser = await getUserById(c.env.DB, user.userId);
  if (!fullUser) return c.json({ success: false, error: '用户不存在' }, 404);

  const pwResult = await verifyPassword(old_password || '', fullUser.password_hash);
  if (!pwResult.valid) return c.json({ success: false, error: '旧密码错误' }, 400);

  const code = generateSixDigitCode();
  await createVerification(c.env.DB, user.userId, 'password_change', code, 10);

  const mailRes = await sendMail(c, {
    to: fullUser.email,
    subject: '【CloudForum】修改密码验证码',
    text: `你的验证码是：${code}\n10 分钟内有效，请勿泄露给他人。如果不是你本人操作，请立即修改密码。`,
    fromName: 'CloudForum',
  });
  if (!mailRes.ok) {
    console.error('[password/request] 邮件发送失败:', mailRes.error);
  }

  return c.json({ success: true, message: '验证码已发送至注册邮箱' });
});

// 第二步：校验验证码并修改密码（成功后踢掉全部会话）
auth.post('/password/verify', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { code, new_password } = await c.req.json().catch(() => ({}));

  const pwCheck = validatePassword(new_password || '');
  if (!pwCheck.valid) return c.json({ success: false, error: pwCheck.error }, 400);

  const ok = await verifyCode(c.env.DB, user.userId, 'password_change', (code || '').trim());
  if (!ok) return c.json({ success: false, error: '验证码错误或已过期' }, 400);

  const newHash = await hashPassword(new_password);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?").bind(newHash, user.userId),
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(user.userId),
    c.env.DB.prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'change_password', '两步验证修改密码')").bind(user.userId),
  ]);

  const fullUser = await getUserById(c.env.DB, user.userId);
  const mailRes = await sendMail(c, {
    to: fullUser?.email || '',
    subject: '【CloudForum】密码修改提醒',
    text: '您的账号密码已被修改。如果不是您本人操作，请立即通过忘记密码功能重置密码。',
    fromName: 'CloudForum',
  });
  if (!mailRes.ok) {
    console.error('[password/verify] 提醒邮件发送失败:', mailRes.error);
  }

  return c.json({ success: true, message: '密码已修改，请重新登录' });
});

// ===== 修改邮箱（两步验证：旧密码 + 邮件验证码，新邮箱暂存 verifications.data）=====

// 第一步：验证旧密码，向新邮箱发送验证码（10 分钟有效）
auth.post('/email/request', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { new_email, password } = await c.req.json().catch(() => ({}));

  const fullUser = await getUserById(c.env.DB, user.userId);
  if (!fullUser) return c.json({ success: false, error: '用户不存在' }, 404);

  const pwResult = await verifyPassword(password || '', fullUser.password_hash);
  if (!pwResult.valid) return c.json({ success: false, error: '密码错误' }, 400);

  const emailCheck = validateEmail(new_email || '');
  if (!emailCheck.valid) return c.json({ success: false, error: emailCheck.error }, 400);

  const normalized = (new_email as string).trim().toLowerCase();
  const existing = await getUserByEmail(c.env.DB, normalized);
  if (existing && existing.id !== user.userId) {
    return c.json({ success: false, error: '该邮箱已被使用' }, 409);
  }

  const code = generateSixDigitCode();
  // 新邮箱暂存 data 列，验证成功后落库
  await createVerification(c.env.DB, user.userId, 'email_verify', code, 10, normalized);

  const mailRes = await sendMail(c, {
    to: normalized,
    subject: '【CloudForum】修改邮箱验证码',
    text: `你的验证码是：${code}\n10 分钟内有效，请勿泄露给他人。如果不是你本人操作，请忽略本邮件。`,
    fromName: 'CloudForum',
  });
  if (!mailRes.ok) {
    console.error('[email/request] 邮件发送失败:', mailRes.error);
  }

  await c.env.DB
    .prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'email_change_request', ?)")
    .bind(user.userId, `申请将邮箱修改为 ${normalized}`)
    .run()
    .catch(() => {});

  return c.json({ success: true, message: '验证码已发送至新邮箱' });
});

// 第二步：校验验证码，将邮箱改为 data 中的新邮箱（成功后踢掉全部会话）
auth.post('/email/verify', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { code } = await c.req.json().catch(() => ({}));

  const pending = await c.env.DB
    .prepare("SELECT data FROM verifications WHERE user_id = ? AND type = 'email_verify' AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1")
    .bind(user.userId)
    .first<{ data: string }>();
  if (!pending || !pending.data) {
    return c.json({ success: false, error: '请先获取验证码' }, 400);
  }

  const ok = await verifyCode(c.env.DB, user.userId, 'email_verify', (code || '').trim());
  if (!ok) return c.json({ success: false, error: '验证码错误或已过期' }, 400);

  const newEmail = pending.data.trim().toLowerCase();
  const fullUser = await getUserById(c.env.DB, user.userId);
  const oldEmail = fullUser?.email || '';

  // 原子落库：改邮箱 + 踢掉全部会话 + 审计日志
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET email = ?, token_version = token_version + 1, email_verified = 1, updated_at = datetime('now') WHERE id = ?").bind(newEmail, user.userId),
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(user.userId),
    c.env.DB.prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'email_change', ?)").bind(user.userId, `邮箱已修改为 ${newEmail}`),
  ]);

  // 通知旧邮箱（失败仅日志）
  const mailRes = await sendMail(c, {
    to: oldEmail,
    subject: '【CloudForum】邮箱修改提醒',
    text: `您的邮箱已被修改为 ${newEmail}，如果不是您本人操作请立即修改密码。`,
    fromName: 'CloudForum',
  });
  if (!mailRes.ok) {
    console.error('[email/verify] 旧邮箱提醒发送失败:', mailRes.error);
  }

  return c.json({ success: true, message: '邮箱已修改，请重新登录' });
});

// 注册邮箱验证：校验注册验证码并标记 email_verified
auth.post('/email/verify-register', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { code } = await c.req.json().catch(() => ({}));

  const ok = await verifyCode(c.env.DB, user.userId, 'email_verify', (code || '').trim());
  if (!ok) return c.json({ success: false, error: '验证码错误或已过期' }, 400);

  await verifyUserEmail(c.env.DB, user.userId);
  await c.env.DB
    .prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'email_verify', '邮箱验证成功')")
    .bind(user.userId)
    .run()
    .catch(() => {});

  return c.json({ success: true, message: '邮箱验证成功' });
});

// 重发邮箱验证码：改邮箱流程（pending data 存了新邮箱）→ 发到新邮箱；注册验证（data 空）→ 发到当前邮箱
auth.post('/email/resend', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);

  const fullUser = await getUserById(c.env.DB, user.userId);
  if (!fullUser) return c.json({ success: false, error: '用户不存在' }, 404);

  const pending = await c.env.DB
    .prepare("SELECT data FROM verifications WHERE user_id = ? AND type = 'email_verify' AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1")
    .bind(user.userId)
    .first<{ data: string }>();

  const code = generateSixDigitCode();
  // data 必须透传：改邮箱流程重发后 verify 仍要能拿到新邮箱
  await createVerification(c.env.DB, user.userId, 'email_verify', code, pending?.data ? 10 : 60, pending?.data || '');

  const to = pending?.data || fullUser.email;
  const mailRes = await sendMail(c, {
    to,
    subject: pending?.data ? '【CloudForum】修改邮箱验证码' : '【CloudForum】邮箱验证',
    text: `你的验证码是：${code}\n${pending?.data ? '10' : '60'} 分钟内有效，请勿泄露给他人。`,
    fromName: 'CloudForum',
  });
  if (!mailRes.ok) {
    console.error('[email/resend] 邮件发送失败:', mailRes.error);
  }

  return c.json({ success: true, message: '验证码已发送' });
});

// 重发改密码验证码（发到当前注册邮箱）
auth.post('/password/resend', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);

  const fullUser = await getUserById(c.env.DB, user.userId);
  if (!fullUser) return c.json({ success: false, error: '用户不存在' }, 404);

  const pending = await c.env.DB
    .prepare("SELECT id FROM verifications WHERE user_id = ? AND type = 'password_change' AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1")
    .bind(user.userId)
    .first<{ id: number }>();
  if (!pending) return c.json({ success: false, error: '请先发起修改密码操作' }, 400);

  const code = generateSixDigitCode();
  await createVerification(c.env.DB, user.userId, 'password_change', code, 10);

  const mailRes = await sendMail(c, {
    to: fullUser.email,
    subject: '【CloudForum】修改密码验证码',
    text: `你的验证码是：${code}\n10 分钟内有效，请勿泄露给他人。`,
    fromName: 'CloudForum',
  });
  if (!mailRes.ok) {
    console.error('[password/resend] 邮件发送失败:', mailRes.error);
  }

  return c.json({ success: true, message: '验证码已发送' });
});


// 修改用户名
auth.put('/username', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { username } = await c.req.json();

  const check = validateUsername(username);
  if (!check.valid) return c.json({ success: false, error: check.error }, 400);

  const existing = await getUserByUsername(c.env.DB, username);
  if (existing) return c.json({ success: false, error: '该用户名已被使用' }, 409);

  await updateUser(c.env.DB, user.userId, { username });

  // 发送站内通知
  try {
    await c.env.DB.prepare(
      "INSERT INTO notifications (user_id, type, content) VALUES (?, 'system', ?)"
    ).bind(user.userId, `用户名已修改为 ${username}`).run();
  } catch (_) {}

  // 签发新 JWT（username 变了；ver 用 DB 最新 token_version，不从旧 payload 复制）
  const dbUser = c.get('dbUser') as User | undefined;
  const newToken = await createToken(
    { userId: user.userId, username, ver: dbUser?.token_version ?? 0 },
    c.env.JWT_SECRET
  );

  return c.json({ success: true, message: '用户名已更新', token: newToken });
});

// 注销账户（3 天冷静期，先标记 scheduled_deleted_at）
auth.delete('/account', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { password } = await c.req.json();

  const fullUser = await getUserById(c.env.DB, user.userId);
  if (!fullUser) return c.json({ success: false, error: '用户不存在' }, 404);

  const pwResult = await verifyPassword(password, fullUser.password_hash);
  if (!pwResult.valid) return c.json({ success: false, error: '密码错误' }, 400);

  // 设置 3 天后自动注销（D1 datetime 格式）
  await c.env.DB
    .prepare("UPDATE users SET scheduled_deleted_at = datetime('now', '+3 days') WHERE id = ?")
    .bind(user.userId)
    .run();

  return c.json({ success: true, message: '账户将在3天后自动注销，期间可取消' });
});

// 验证密码（注销前确认身份）
auth.post('/verify-password', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { password } = await c.req.json();

  const fullUser = await getUserById(c.env.DB, user.userId);
  if (!fullUser) return c.json({ success: false, error: '用户不存在' }, 404);

  const pwResult = await verifyPassword(password, fullUser.password_hash);
  if (!pwResult.valid) return c.json({ success: false, error: '密码错误' }, 400);

  return c.json({ success: true, message: '密码验证通过' });
});

// 取消注销
auth.post('/cancel-deletion', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);

  await c.env.DB
    .prepare("UPDATE users SET scheduled_deleted_at = NULL WHERE id = ?")
    .bind(user.userId)
    .run();

  return c.json({ success: true, message: '已取消账户注销' });
});

// 获取当前用户
auth.get('/me', async (c) => {
  const user: JWTPayload = c.get('user');

  // 从 requireAuth 缓存中取用户（无需再查库）
  const fullUser: User | undefined = c.get('dbUser');
  if (!fullUser) return c.json({ success: false, error: '用户不存在' }, 404);

  // 封禁状态
  let banned_until: string | null = null;
  if (fullUser.banned_until) {
    const bannedUntil = new Date(fullUser.banned_until.replace(' ', 'T') + 'Z');
    if (bannedUntil.getTime() > Date.now()) banned_until = fullUser.banned_until;
  }

  // 查询 VIP 状态
  const vipInfo = await c.env.DB
    .prepare("SELECT tier FROM user_vips WHERE user_id = ? AND expires_at > datetime('now')")
    .bind(user.userId)
    .first<{ tier: string }>();

  return c.json({
    success: true,
    data: {
      id: fullUser.id,
      username: fullUser.username,
      email: fullUser.email,
      avatar_url: fullUser.avatar_url,
      bio: fullUser.bio,
      role: fullUser.role,
      email_verified: fullUser.email_verified || 0,
      banned_until,
      scheduled_deleted_at: fullUser.scheduled_deleted_at,
      is_vip: !!vipInfo,
      vip_tier: vipInfo?.tier || null,
      custom_title: fullUser.custom_title || null,
      nick_theme: fullUser.nick_theme || null,
      title_badge: fullUser.title_badge || null,
      title_badge_expires_at: fullUser.title_badge_expires_at || null,
      avatar_frame: fullUser.avatar_frame || null,
      avatar_frame_expires_at: fullUser.avatar_frame_expires_at || null,
      created_at: fullUser.created_at,
    },
  });
});

// 刷新 token — 轮换制：每次刷新删旧发新；已被轮换的旧 token 被重用视为重放攻击，吊销该用户全部会话
auth.post('/refresh', async (c) => {
  const { refresh_token } = await c.req.json();
  if (!refresh_token) return c.json({ success: false, error: '缺少 refresh token' }, 400);
  try {
    const hash = await hashRefreshToken(refresh_token);
    const row = await c.env.DB
      .prepare('SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash = ?')
      .bind(hash)
      .first<{ user_id: number; expires_at: string }>();
    if (!row) {
      // 未命中：查轮换审计——该哈希 7 天内被轮换过且轮换已超过 30 秒则视为重放（吊销全部会话）；
      // 30 秒内的轮换属于合法并发/重试窗口（客户端刚拿到新 token 又重试旧 token），不吊销，仅按无效处理
      const rotated = await c.env.DB
        .prepare("SELECT user_id FROM security_logs WHERE action = 'refresh_rotate' AND detail = ? AND created_at >= datetime('now', '-7 days') AND created_at <= datetime('now', '-30 seconds')")
        .bind(hash)
        .first<{ user_id: number }>();
      if (rotated) {
        // 重放：吊销该用户全部 refresh token + token_version + 1（旧 JWT 一并失效）
        await c.env.DB.batch([
          c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(rotated.user_id),
          c.env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').bind(rotated.user_id),
        ]);
        return c.json({ success: false, error: '登录已过期' }, 401);
      }
      return c.json({ success: false, error: 'refresh token 无效' }, 401);
    }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    if (row.expires_at < now) {
      await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').bind(hash).run();
      return c.json({ success: false, error: 'refresh token 已过期，请重新登录' }, 401);
    }
    const user = await c.env.DB
      .prepare('SELECT id, username, token_version FROM users WHERE id = ? AND deleted_at IS NULL')
      .bind(row.user_id)
      .first<{ id: number; username: string; token_version: number }>();
    if (!user) return c.json({ success: false, error: '用户不存在' }, 404);

    // 轮换：删旧行 + 记审计（供重放检测）+ 发新 refresh token（有效期重置为 90 天，滑动续期）
    const newRt = createRefreshToken();
    const newHash = await hashRefreshToken(newRt);
    const expires = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').bind(hash),
      c.env.DB.prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'refresh_rotate', ?)").bind(user.id, hash),
      c.env.DB.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').bind(user.id, newHash, expires),
    ]);

    // 签发新 JWT（带最新 token_version）
    const token = await createToken(
      { userId: user.id, username: user.username, ver: user.token_version },
      c.env.JWT_SECRET
    );
    return c.json({ success: true, data: { token, refresh_token: newRt }, message: 'token 已刷新' });
  } catch (err) {
    console.error('refresh error:', err);
    return c.json({ success: false, error: '刷新失败' }, 500);
  }
});

// 登出：吊销该用户全部会话（删所有 refresh token + token_version+1，access token 立即失效）
// 修复：原实现只删 1 条 refresh 行且不递增 token_version——泄露 token 登出后仍可续签/使用 7 天
auth.post('/logout', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(user.userId),
      c.env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').bind(user.userId),
    ]);
  } catch {}
  return c.json({ success: true, message: '已登出' });
});

// ===== 用户邀请码（拉新奖励）=====

// 生成我的邀请码：同时只允许 1 个未使用（用完才能生成新的，防囤码/刷分）
auth.post('/invites', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');

  const cnt = await c.env.DB
    .prepare('SELECT COUNT(*) as c FROM invite_codes WHERE created_by = ? AND used_by IS NULL')
    .bind(user.userId)
    .first<{ c: number }>();
  if ((cnt?.c || 0) >= 1) {
    return c.json({ success: false, error: '你已有一个未使用的邀请码，等朋友注册使用后可再生成新的' }, 400);
  }

  // 生成 8 字符邀请码（与 admin 生成同字符集，去易混淆字符）
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    code = '';
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    for (let i = 0; i < 8; i++) {
      code += chars[buf[i] % chars.length];
    }
    const existing = await c.env.DB.prepare('SELECT code FROM invite_codes WHERE code = ?').bind(code).first();
    if (!existing) break;
  }
  if (!code) return c.json({ success: false, error: '生成失败，请重试' }, 500);

  await c.env.DB.prepare('INSERT INTO invite_codes (code, created_by) VALUES (?, ?)').bind(code, user.userId).run();
  return c.json({ success: true, data: { code }, message: '邀请码已生成' });
});

// 我的邀请码列表 + 邀请统计
auth.get('/invites', requireAuth, async (c) => {
  const user: JWTPayload = c.get('user');

  // 已邀请人数按 invite_codes.used_by 统计（流水只保留最近 15 条，不能依赖 invite_reward 流水计数）
  const [codes, used, rewardCfg] = await Promise.all([
    c.env.DB
      .prepare('SELECT code, created_at FROM invite_codes WHERE created_by = ? AND used_by IS NULL ORDER BY created_at DESC')
      .bind(user.userId)
      .all<{ code: string; created_at: string }>(),
    c.env.DB
      .prepare("SELECT COUNT(*) as c FROM invite_codes WHERE created_by = ? AND used_by IS NOT NULL AND used_by != ''")
      .bind(user.userId)
      .first<{ c: number }>(),
    c.env.DB
      .prepare("SELECT value FROM settings WHERE key = 'invite_reward_coins'")
      .first<{ value: string }>(),
  ]);

  // 奖励总额 = 邀请人数 × 单次奖励（settings invite_reward_coins，默认 120；与注册发奖口径一致）
  const rewardPer = parseInt(rewardCfg?.value || '120', 10) || 120;
  const invitedCount = used?.c || 0;

  return c.json({
    success: true,
    data: {
      codes: codes.results || [],
      invited_count: invitedCount,
      total_reward: invitedCount * rewardPer,
    },
  });
});

// ===== 忘记密码（邮件验证码）=====

// 发送 6 位数字验证码邮件（10 分钟有效）
// 统一响应防枚举：用户不存在也返回成功，仅在日志记录
auth.post('/forgot', async (c) => {
  const { email } = await c.req.json().catch(() => ({}));
  if (!email || typeof email !== 'string') {
    return c.json({ success: false, error: '请输入邮箱' }, 400);
  }
  const normalized = email.trim().toLowerCase();

  const user = await getUserByEmail(c.env.DB, normalized);
  if (user) {
    // 6 位数字验证码（crypto 安全随机）
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    const code = Array.from(buf).map((b) => b % 10).join('');

    await createVerification(c.env.DB, user.id, 'password_reset', code, 10);
    const mailRes = await sendMail(c, {
      to: user.email,
      subject: '【CloudForum】重置密码验证码',
      text: `你的验证码是：${code}\n10 分钟内有效，请勿泄露给他人。如果不是你本人操作，请忽略本邮件。`,
      fromName: 'CloudForum',
    });
    if (!mailRes.ok) {
      console.error('[forgot] 邮件发送失败:', mailRes.error);
    }
    await c.env.DB
      .prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'forgot_password', ?)")
      .bind(user.id, mailRes.ok ? '发送重置验证码' : `发送失败: ${mailRes.error}`)
      .run()
      .catch(() => {});
  }
  return c.json({ success: true, message: '如果该邮箱已注册，验证码已发送至邮箱' });
});

// 校验验证码并重置密码（成功后踢掉该用户全部会话）
auth.post('/reset', async (c) => {
  const { email, code, new_password } = await c.req.json().catch(() => ({}));
  if (!email || typeof email !== 'string') return c.json({ success: false, error: '请输入邮箱' }, 400);
  if (!code || typeof code !== 'string') return c.json({ success: false, error: '请输入验证码' }, 400);

  const pwCheck = validatePassword(new_password || '');
  if (!pwCheck.valid) return c.json({ success: false, error: pwCheck.error }, 400);

  const user = await getUserByEmail(c.env.DB, email.trim().toLowerCase());
  if (!user) return c.json({ success: false, error: '验证码错误或已过期' }, 400);

  const ok = await verifyCode(c.env.DB, user.id, 'password_reset', code.trim());
  if (!ok) return c.json({ success: false, error: '验证码错误或已过期' }, 400);

  const hash = await hashPassword(new_password);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?").bind(hash, user.id),
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'reset_password', '验证码重置密码')").bind(user.id),
  ]);

  return c.json({ success: true, message: '密码已重置，请重新登录' });
});

export default auth;
