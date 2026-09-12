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
  inviteOnlyOn,
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

  // 邀请码策略（后台「仅邀请注册」开关 settings.invite_only）：
  //   · 未设置按「开启」兜底（老库一致性，见 inviteOnlyOn）
  //   · 开关关闭时注册不强制邀请码，但用户主动填写有效邀请码仍然占码 + 给邀请人发奖励
  //   · 开关开启时才强制；站点还没有管理员（引导首个管理员）时不强制，否则新站点会自锁
  const adminCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").first<{ count: number }>();
  const hasAdmin = adminCount && adminCount.count > 0;
  const inviteCfg = await c.env.DB
    .prepare("SELECT value FROM settings WHERE key = 'invite_only'")
    .first<{ value: string }>();
  const requiresInvite = !!hasAdmin && inviteOnlyOn(inviteCfg?.value);

  if (requiresInvite && !invite_code) {
    return c.json({ success: false, error: '注册需要邀请码' }, 400);
  }

  // 填了邀请码就一定要有效（方案 A）：不强制时也报错而不是静默忽略，
  // 避免用户以为「已经给邀请人记上了」；并发占用由下方原子占码兜底
  let inviteValid = false;
  if (invite_code) {
    const invite = await c.env.DB
      .prepare('SELECT code FROM invite_codes WHERE code = ? AND used_by IS NULL')
      .bind(invite_code).first();
    if (!invite) {
      return c.json({ success: false, error: '邀请码无效或已使用' }, 400);
    }
    inviteValid = true;
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

  // 原子占码：填了有效邀请码就占码 + 发邀请奖励（开关关闭时的「主动填码」同样走这里）。
  // 占码失败 = 并发被抢：强制模式下回滚刚创建的用户并报错；选填模式下照常注册、只是不发奖
  if (inviteValid && invite_code) {
    const claim = await c.env.DB
      .prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE code = ? AND used_by IS NULL")
      .bind(user.id, invite_code).run();
    if (!claim.meta.changes) {
      if (requiresInvite) {
        // 回滚刚创建的用户：先删 user_balances（FK 无级联），再删用户，避免外键约束报错
        await c.env.DB.batch([
          c.env.DB.prepare('DELETE FROM user_balances WHERE user_id = ?').bind(user.id),
          c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
        ]);
        return c.json({ success: false, error: '邀请码已被使用' }, 400);
      }
      console.error('[register] 邀请码并发占用，选填模式继续注册（不发奖励）:', invite_code);
    } else {
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

  // 生成邮箱验证码并发送（注册后 email_verified=0，须在资料页验证；失败仅日志，不阻塞注册）。
  // 走统一发码入口（带 60 秒静默期）：此后验证页的自动发码请求不会重复发信、也不会作废这封的码
  const regCode = await sendVerificationCode(c, {
    userId: user.id,
    type: 'email_verify',
    to: user.email,
    minutes: 30,
    subject: '【CloudForum】邮箱验证',
  });
  if (regCode.mailError) {
    console.error('[register] 验证码邮件发送失败:', regCode.mailError);
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
      // 注册已发验证码：前端跳验证页时用它显示「验证码已发送至 xxx」，无需再触发一次发送
      masked_email: maskEmail(user.email),
      code_sent: regCode.sent,
      code_silenced: !regCode.sent,
    },
    message: '注册成功',
  });
});

// 验证码邮件正文（text + html 双版本）：html 用大字号验证码 + 显式段落换行，
// 避免纯文本邮件被客户端吞掉换行导致「验证码60分钟」粘连误读
function verificationMailBody(code: string, minutes: number): { text: string; html: string } {
  return {
    text: `你的验证码是：${code}\n请在 ${minutes} 分钟内完成验证，请勿泄露给他人。如果不是你本人操作，请忽略本邮件。`,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111;">
  <h2 style="margin:0 0 16px;font-size:18px;">CloudForum 邮箱验证</h2>
  <p style="margin:0 0 12px;">你的验证码是：</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:0 0 16px;">${code}</p>
  <p style="margin:0 0 8px;">请在 <strong>${minutes} 分钟内</strong>完成验证，请勿泄露给他人。</p>
  <p style="margin:0;color:#999;font-size:12px;">如果不是你本人操作，请忽略本邮件。</p>
</div>`,
  };
}

// 邮箱脱敏：本地部分保留前 2 后 2（过短只保留前 1），域名完整——可辨认又不易被猜
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const keep = local.length <= 4 ? 1 : 2;
  const masked = local.length <= keep * 2 ? local.slice(0, 1) + '***' : local.slice(0, keep) + '***' + local.slice(-keep);
  return `${masked}@${domain}`;
}

// 登录失败计数：fail_count >= 15 锁 20 分钟，>= 8 锁 5 分钟；锁定时清零，到期后重新计数
// 锁定时长加入随机抖动，避免攻击者按固定节奏循环锁号（DoS 缓解）
// 2026-09-11 放宽：原为 >=10 锁 30 分钟 / >=5 锁 15 分钟——正常用户连打几次错字就被锁太久；
// 该机制只锁单个账号（不牵连他人）+ IP 限流仍在，放宽后防护依旧充分
async function recordLoginFailure(db: D1Database, userId: number): Promise<void> {
  await db.prepare(
    'INSERT INTO login_attempts (user_id, fail_count, locked_until) VALUES (?, 1, NULL) ON CONFLICT(user_id) DO UPDATE SET fail_count = fail_count + 1'
  ).bind(userId).run();
  const attempts = await db.prepare('SELECT fail_count FROM login_attempts WHERE user_id = ?').bind(userId).first<{ fail_count: number }>();
  const count = attempts?.fail_count || 1;
  const jitter = (crypto.getRandomValues(new Uint32Array(1))[0] % 10); // 锁定时长随机抖动，防固定节奏循环锁号
  if (count >= 15) {
    await db.prepare(`UPDATE login_attempts SET locked_until = datetime('now', '+${20 + jitter} minutes'), fail_count = 0 WHERE user_id = ?`).bind(userId).run();
  } else if (count >= 8) {
    await db.prepare(`UPDATE login_attempts SET locked_until = datetime('now', '+${5 + (jitter % 5)} minutes'), fail_count = 0 WHERE user_id = ?`).bind(userId).run();
  }
}

// 防账号枚举：未知账号也做一次真实 PBKDF2 校验，避免响应时延差异泄露账号存在性（冷启动算一次后复用）
let dummyHash: string | undefined;
async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= await hashPassword('dummy-password-1');
  await verifyPassword(password, dummyHash);
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
    // 防枚举：真实账号在下方会做一次完整 PBKDF2 验证，未知账号也先做等量计算再返回，抹平时延差
    await dummyVerify(password);
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
  // 责令更换邮箱：管理员要求换绑新邮箱，未完成前拦截登录（密码已验证，签发 10 分钟换邮箱凭证）
  if (row.email_change_ordered) {
    const changeToken = createRefreshToken();
    await createVerification(c.env.DB, row.id, 'email_change_token', changeToken, 10);
    return c.json({
      success: false,
      error: '管理员要求你更换绑定邮箱，请先完成更换后登录',
      data: {
        need_email_change: true,
        change_token: changeToken,
        reason: row.email_change_reason || '',
      },
    }, 403);
  }

  if (verifyCfg && (verifyCfg.value === '1' || verifyCfg.value === 'true') && !row.email_verified) {
    // 未验证账号引导走免登录验证页（/verify-email → verify-guest/resend-guest，发码到注册邮箱）
    return c.json({ success: false, error: '邮箱未验证，请先完成邮箱验证' }, 403);
  }

  // 登录成功：清空该用户与 0 桶的失败计数
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE user_id IN (0, ?)').bind(row.id).run();

  // 渐进升级：旧格式（saltB64.hashB64，含 '.' 且不含 '$'）验证通过后透明重哈希为自描述新格式
  // （pbkdf2$…，失败仅记日志，不影响登录；重哈希直接用刚验证通过的明文密码，无需用户重新输入）
  if (row.password_hash.includes('.') && !row.password_hash.includes('$')) {
    try {
      const upgraded = await hashPassword(password);
      await c.env.DB
        .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(upgraded, row.id)
        .run();
    } catch (e) {
      console.error('password upgrade failed', e);
    }
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

// ===== 发码统一入口（带 60 秒静默期）=====
// 静默期：同一用户 + 同一用途 + 同一目标（data，改邮箱流程存新邮箱）在 60 秒内
// 已有「未使用且未过期」的验证码时，重复请求不再生成新码、也不再发信，直接视为"已发送"。
// 解决两个真实问题（2026-09-13 排查）：
//   ① 前端多点触发（注册成功后跳验证页、该页 on-mount 自动发码）会连发两封；
//   ② 连点「重新发送」每次都作废旧码，用户手里那封的码必然验证失败（新码才是唯一有效码）。
// 静默期后（>60 秒）重发仍走原逻辑：作废旧码、发新码。
const CODE_SILENCE_SECONDS = 60;

async function hasFreshVerificationCode(
  db: D1Database,
  userId: number,
  type: 'email_verify' | 'password_reset',
  data: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM verifications
       WHERE user_id = ? AND type = ? AND COALESCE(data, '') = ? AND used = 0
         AND expires_at > datetime('now')
         AND created_at > datetime('now', '-${CODE_SILENCE_SECONDS} seconds')
       ORDER BY id DESC LIMIT 1`
    )
    .bind(userId, type, data)
    .first();
  return !!row;
}

/**
 * 生成并发送验证码（统一入口）。
 * 返回 sent=false 表示命中静默期：未生成新码、未发信，用户手里的旧码依然有效；
 * 返回 mailError 时表示已生成新码但邮件发送失败（调用方按原有分支处理）。
 */
async function sendVerificationCode(
  c: { env: Env },
  opts: {
    userId: number;
    type: 'email_verify' | 'password_reset';
    to: string;
    minutes: number;
    data?: string;
    subject: string;
  }
): Promise<{ sent: boolean; code: string; mailError?: string }> {
  const data = opts.data || '';
  if (await hasFreshVerificationCode(c.env.DB, opts.userId, opts.type, data)) {
    return { sent: false, code: '' };
  }
  const code = generateSixDigitCode();
  await createVerification(c.env.DB, opts.userId, opts.type, code, opts.minutes, data);
  const body = verificationMailBody(code, opts.minutes);
  const mailRes = await sendMail(c, {
    to: opts.to,
    subject: opts.subject,
    text: body.text,
    html: body.html,
    fromName: 'CloudForum',
  });
  return { sent: true, code, mailError: mailRes.ok ? undefined : mailRes.error };
}

// 修改密码（登录态一步直改）：验证当前密码后直接设置新密码，不发验证码。
// 成功后踢掉全部会话（token_version+1 + 删 refresh_tokens），需重新登录
auth.put('/password', requireAuth, async (c) => {
  const user: JWTPayload | undefined = c.get('user');
  if (!user) return c.json({ success: false, error: '请先登录' }, 401);
  const { current_password, new_password } = await c.req.json().catch(() => ({}));

  const fullUser = await getUserById(c.env.DB, user.userId);
  if (!fullUser) return c.json({ success: false, error: '用户不存在' }, 404);

  const pwResult = await verifyPassword(current_password || '', fullUser.password_hash);
  if (!pwResult.valid) return c.json({ success: false, error: '当前密码错误' }, 400);

  const pwCheck = validatePassword(new_password || '');
  if (!pwCheck.valid) return c.json({ success: false, error: pwCheck.error }, 400);

  const newHash = await hashPassword(new_password);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?").bind(newHash, user.userId),
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(user.userId),
    c.env.DB.prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'change_password', '修改密码（当前密码验证）')").bind(user.userId),
  ]);

  // 修改提醒发到注册邮箱（安全通知，非验证；失败仅日志）
  const mailRes = await sendMail(c, {
    to: fullUser.email,
    subject: '【CloudForum】密码修改提醒',
    text: '您的账号密码已被修改。如果不是您本人操作，请立即通过忘记密码功能重置密码。',
    fromName: 'CloudForum',
  });
  if (!mailRes.ok) {
    console.error('[password] 提醒邮件发送失败:', mailRes.error);
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

  // 发码到新邮箱（10 分钟有效；60 秒静默期避免重复发信/作废手里那封）
  const bindCode = await sendVerificationCode(c, {
    userId: user.userId,
    type: 'email_verify',
    to: normalized,
    minutes: 10,
    data: normalized,
    subject: '【CloudForum】修改邮箱验证码',
  });
  if (bindCode.mailError) {
    console.error('[email/request] 邮件发送失败:', bindCode.mailError);
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

// 登录前邮箱验证（免登录）：require_email_verify 开启时登录被 403 拦截，
// 而旧验证端点全部要求登录态——形成「未验证 → 无法登录 → 无法验证」死循环。
// 此端点按「用户名或邮箱」定位用户 + 验证码完成验证，与忘记密码的免登录模式一致。
// 文案策略（用户要求明确提示，不做防枚举静默）：账号不存在 → 「该邮箱未注册」；已验证 → 幂等成功。
auth.post('/email/verify-guest', async (c) => {
  const { account, code } = await c.req.json().catch(() => ({}));
  const normalized = typeof account === 'string' ? account.trim().toLowerCase() : '';
  if (!normalized || !code) return c.json({ success: false, error: '请输入用户名/邮箱和验证码' }, 400);

  const row = await c.env.DB
    .prepare('SELECT id, email_verified FROM users WHERE (email = ? OR username = ?) AND deleted_at IS NULL')
    .bind(normalized, account.trim())
    .first<{ id: number; email_verified: number }>();
  if (!row) return c.json({ success: false, error: '该邮箱未注册：若你记错了绑定邮箱，可改用注册时的用户名查询' }, 400);
  if (row.email_verified) return c.json({ success: true, message: '邮箱已验证，请直接登录' });

  const ok = await verifyCode(c.env.DB, row.id, 'email_verify', String(code).trim());
  if (!ok) return c.json({ success: false, error: '验证码错误或已过期' }, 400);

  await verifyUserEmail(c.env.DB, row.id);
  await c.env.DB
    .prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'email_verify', '邮箱验证成功（登录前验证）')")
    .bind(row.id)
    .run()
    .catch(() => {});

  return c.json({ success: true, message: '邮箱验证成功，请登录' });
});

// 登录前重发验证码（免登录）：按「用户名或邮箱」定位用户，发码到绑定的真实邮箱，
// 并返回脱敏后的绑定邮箱（用户名定位时帮用户回忆绑定的是哪个邮箱；中间打码防猜测）。
// 文案策略（用户要求明确提示）：不存在 → 「该邮箱未注册」；已验证 → 提示直接登录。
auth.post('/email/resend-guest', async (c) => {
  const { account } = await c.req.json().catch(() => ({}));
  const normalized = typeof account === 'string' ? account.trim().toLowerCase() : '';
  if (!normalized) return c.json({ success: false, error: '请输入用户名或邮箱' }, 400);

  const row = await c.env.DB
    .prepare('SELECT id, username, email, email_verified FROM users WHERE (email = ? OR username = ?) AND deleted_at IS NULL')
    .bind(normalized, account.trim())
    .first<{ id: number; username: string; email: string; email_verified: number }>();
  if (!row) return c.json({ success: false, error: '该邮箱未注册：若你记错了绑定邮箱，可改用注册时的用户名查询' }, 400);
  if (row.email_verified) {
    return c.json({ success: false, error: '该邮箱已验证，请直接登录' });
  }

  // 走统一发码入口（60 秒静默期）：验证页自动发码/用户连点重发时不会重复发信、也不作废手里那封的码
  const guestCode = await sendVerificationCode(c, {
    userId: row.id,
    type: 'email_verify',
    to: row.email,
    minutes: 30,
    subject: '【CloudForum】邮箱验证',
  });
  if (guestCode.mailError) {
    console.error('[email/resend-guest] 邮件发送失败:', guestCode.mailError);
    return c.json({ success: false, error: '验证码发送失败，请稍后重试' }, 502);
  }
  return c.json({
    success: true,
    message: '验证码已发送，请查收邮件',
    data: { masked_email: maskEmail(row.email), code_silenced: !guestCode.sent },
  });
});

// 责令换邮箱凭证校验：verifications 表 type='email_change_token'（随机码、一次性、10 分钟），
// 登录时密码已验证后签发，仅可用于 change-guest 换邮箱流程，不能通过 requireAuth
async function verifyChangeToken(db: D1Database, token: unknown): Promise<number | null> {
  if (typeof token !== 'string' || !token) return null;
  const row = await db
    .prepare("SELECT user_id FROM verifications WHERE type = 'email_change_token' AND code = ? AND used = 0 AND expires_at > datetime('now')")
    .bind(token)
    .first<{ user_id: number }>();
  return row?.user_id ?? null;
}

// 责令换邮箱第一步：向用户输入的新邮箱发码（校验格式 + 未被其他账号占用；目标邮箱记入 data）
auth.post('/email/change-guest/request', async (c) => {
  const { change_token, email } = await c.req.json().catch(() => ({}));
  const userId = await verifyChangeToken(c.env.DB, change_token);
  if (!userId) return c.json({ success: false, error: '更换凭证已过期，请重新登录' }, 401);
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const formatCheck = validateEmail(normalized);
  if (!formatCheck.valid) return c.json({ success: false, error: formatCheck.error }, 400);
  const occupied = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .bind(normalized, userId)
    .first<{ id: number }>();
  if (occupied) return c.json({ success: false, error: '该邮箱已被其他账号绑定' }, 409);

  // 走统一发码入口（60 秒静默期，按 data=新邮箱 分桶：同一新邮箱不重复发信，换新邮箱照常发）
  const bindCode = await sendVerificationCode(c, {
    userId,
    type: 'email_verify',
    to: normalized,
    minutes: 30,
    data: normalized,
    subject: '【CloudForum】绑定新邮箱',
  });
  if (bindCode.mailError) {
    console.error('[email/change-guest/request] 邮件发送失败:', bindCode.mailError);
    return c.json({ success: false, error: '验证码发送失败，请稍后重试' }, 502);
  }
  return c.json({
    success: true,
    message: '验证码已发送，请查收邮件',
    data: { masked_email: maskEmail(normalized), code_silenced: !bindCode.sent },
  });
});

// 责令换邮箱第二步：验证码确认 → 换绑新邮箱 + 清除责令 + email_verified=1 → 直接签发登录态
auth.post('/email/change-guest/confirm', async (c) => {
  const { change_token, email, code } = await c.req.json().catch(() => ({}));
  const userId = await verifyChangeToken(c.env.DB, change_token);
  if (!userId) return c.json({ success: false, error: '更换凭证已过期，请重新登录' }, 401);
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized || !code) return c.json({ success: false, error: '请输入邮箱和验证码' }, 400);

  // 必须匹配「发码时记录的目标邮箱」（data），防止拿 A 邮箱的验证码绑 B 邮箱
  const ver = await c.env.DB
    .prepare("SELECT id, code FROM verifications WHERE user_id = ? AND type = 'email_verify' AND data = ? AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1")
    .bind(userId, normalized)
    .first<{ id: number; code: string }>();
  if (!ver || ver.code !== String(code).trim()) return c.json({ success: false, error: '验证码错误或已过期' }, 400);

  const occupied = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .bind(normalized, userId)
    .first<{ id: number }>();
  if (occupied) return c.json({ success: false, error: '该邮箱已被其他账号绑定' }, 409);

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE verifications SET used = 1 WHERE id = ?').bind(ver.id),
    c.env.DB.prepare("UPDATE users SET email = ?, email_verified = 1, email_change_ordered = 0, email_change_reason = NULL, email_change_ordered_at = NULL, updated_at = datetime('now') WHERE id = ?").bind(normalized, userId),
    c.env.DB.prepare("UPDATE verifications SET used = 1 WHERE type = 'email_change_token' AND code = ?").bind(change_token),
  ]);
  await c.env.DB
    .prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'email_change_ordered', '责令更换邮箱已完成')")
    .bind(userId)
    .run()
    .catch(() => {});

  const user = await getUserById(c.env.DB, userId);
  if (!user) return c.json({ success: false, error: '用户不存在' }, 404);
  const token = await createToken({ userId: user.id, username: user.username, ver: user.token_version }, c.env.JWT_SECRET);
  const refresh_token = await generateAndStoreRefreshToken(c.env.DB, user.id);
  return c.json({
    success: true,
    message: '邮箱更换成功',
    data: {
      token,
      refresh_token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role, email_verified: 1 },
    },
  });
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

  // data 必须透传：改邮箱流程重发后 verify 仍要能拿到新邮箱；60 秒静默期内不重复发信
  const resendData = pending?.data || '';
  const resendMinutes = pending?.data ? 10 : 30;
  const resend = await sendVerificationCode(c, {
    userId: user.userId,
    type: 'email_verify',
    to: resendData || fullUser.email,
    minutes: resendMinutes,
    data: resendData,
    subject: pending?.data ? '【CloudForum】修改邮箱验证码' : '【CloudForum】邮箱验证',
  });
  if (resend.mailError) {
    console.error('[email/resend] 邮件发送失败:', resend.mailError);
  }

  return c.json({ success: true, message: '验证码已发送', data: { code_silenced: !resend.sent } });
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
    // 走统一发码入口（10 分钟有效；60 秒静默期内重复请求不重复发信）
    const reset = await sendVerificationCode(c, {
      userId: user.id,
      type: 'password_reset',
      to: user.email,
      minutes: 10,
      subject: '【CloudForum】重置密码验证码',
    });
    if (reset.mailError) {
      console.error('[forgot] 邮件发送失败:', reset.mailError);
    }
    await c.env.DB
      .prepare("INSERT INTO security_logs (user_id, action, detail) VALUES (?, 'forgot_password', ?)")
      .bind(user.id, reset.mailError ? `发送失败: ${reset.mailError}` : (reset.sent ? '发送重置验证码' : '静默期内未重复发送'))
      .run()
      .catch(() => {});
  } else {
    // 账号不存在：保持静默成功（统一响应防枚举），但先做一次等量 PBKDF2 计算抹平时延差
    // （dummyVerify 的入参不影响计算量，传探测输入本身即可）
    await dummyVerify(normalized);
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
  if (!user) {
    // 防枚举：账号不存在与「验证码错误」返回同一错误文案，这里补一次等量 PBKDF2 计算，
    // 避免不存在的邮箱响应明显更快从而泄露账号存在性
    await dummyVerify(new_password || '');
    return c.json({ success: false, error: '验证码错误或已过期' }, 400);
  }

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
