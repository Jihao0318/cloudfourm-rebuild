import { Hono } from 'hono';
import type { Env } from './types';
import { cors } from './middleware/cors';
import { requireAuth, optionalAuth } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';
import { inviteOnlyOn } from './db/queries';

import authHandler from './handlers/auth';
import reviewHandler from './handlers/review';
import moderationHandler from './handlers/moderation';
import postsHandler from './handlers/posts';
import commentsHandler from './handlers/comments';
import categoriesHandler from './handlers/categories';
import likesHandler from './handlers/likes';
import uploadHandler from './handlers/upload';
import usersHandler from './handlers/users';
import adminHandler from './handlers/admin';
import statsHandler from './handlers/stats';
import coinsHandler from './handlers/coins';
import checkInHandler from './handlers/check-in';
import vipHandler from './handlers/vip';
import reportsHandler from './handlers/reports';
import appealsHandler from './handlers/appeals';
import followsHandler from './handlers/follows';
import notificationsHandler from './handlers/notifications';
import bookmarksHandler from './handlers/bookmarks';
import shopHandler from './handlers/shop';
import tipsHandler from './handlers/tips';
import decorationsHandler from './handlers/decorations';
import lotteryCoinsHandler from './handlers/lottery-coins';
import leaderboardHandler from './handlers/leaderboard';
import unbanHandler from './handlers/unban';
import itemsHandler from './handlers/items';
import pushHandler from './handlers/push';
import tasksHandler from './handlers/tasks';
import achievementsHandler from './handlers/achievements';
import thanksHandler from './handlers/thanks';


export function setupRoutes(app: Hono<{ Bindings: Env }>) {
  // 全局中间件（errorHandler 由 index.ts 中的 app.onError 统一处理）
  app.use('*', cors);

  // 健康检查 — 启动期校验：JWT_SECRET 缺失时返回错误，提醒部署者配置
  app.get('/api/health', (c) => {
    if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 16) {
      return c.json({
        success: false,
        message: 'JWT_SECRET 未配置或长度不足，请通过 wrangler secret put JWT_SECRET 设置一个 32 字符以上的密钥',
        timestamp: Date.now(),
      }, 503);
    }
    return c.json({ success: true, message: 'OK', timestamp: Date.now() });
  });

  // 公共系统设置（公告 / 注册策略）— 无需认证
  // announcement_updated_at 作为公告版本号：前端用它实现「每次更新公告重新提醒」
  // invite_only：注册是否强制邀请码（注册页据此显示「必填 / 选填」文案）
  app.get('/api/settings/public', async (c) => {
    const rows = await c.env.DB
      .prepare("SELECT key, value, updated_at FROM settings WHERE key IN ('announcement', 'invite_only')")
      .all<{ key: string; value: string; updated_at: string }>();
    const m = new Map((rows.results || []).map((r) => [r.key, r]));
    return c.json({
      success: true,
      data: {
        announcement: m.get('announcement')?.value || '',
        announcement_updated_at: m.get('announcement')?.updated_at || '',
        invite_only: inviteOnlyOn(m.get('invite_only')?.value),
      },
    });
  });

  // Auth — 无需认证: register/login/forgot/reset
  // 限流保护：认证端点 failClosed（D1 异常时拒绝而非放行），其余端点 fail-open
  //
  // 阈值策略（2026-09-11 整体放宽一档）：原阈值对真实用户偏严——同宿舍/公司出口 NAT 共用一个 IP，
  // 加上「填错也计数」，正常使用中很容易撞上限且要等整窗口。现按「比原值宽 2-3 倍」设定：
  //   · 每分钟类：10 次/分钟（refresh 30 次，多标签页刷新 token 不能被误伤）
  //   · 5 分钟类：验证码校验 15 次、请求/重发验证码 10 次（change-guest/request 8 次：会向任意新邮箱发信）
  //   · 注册：10 次/小时（真正的门槛是邀请码，限流只防脚本批量刷号）
  //   · 改密码：10 次/10 分钟（该端点已要求登录态，爆破走 /auth/login 更省事）
  // 防护底线不变：6 位验证码 30 分钟有效，15 次/5 分钟的猜码量级仍远不足以命中。
  app.use('/api/auth/login', rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'login', failClosed: true }));
  app.use('/api/auth/register', rateLimit({ windowSeconds: 3600, maxRequests: 10, keyPrefix: 'register', failClosed: true }));
  app.use('/api/auth/verify-password', rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'verify-password', failClosed: true }));
  app.use('/api/auth/account', rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'account' }));
  app.use('/api/auth/username', rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'username' }));
  app.use('/api/auth/cancel-deletion', rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'cancel-deletion' }));
  app.use('/api/auth/refresh', rateLimit({ windowSeconds: 60, maxRequests: 30, keyPrefix: 'refresh', failClosed: true }));
  // 邮箱/密码两步验证端点限流（防验证码爆破/邮件轰炸，全部 failClosed）
  app.use('/api/auth/email/request', rateLimit({ windowSeconds: 300, maxRequests: 10, keyPrefix: 'email-request', failClosed: true }));
  app.use('/api/auth/email/verify', rateLimit({ windowSeconds: 300, maxRequests: 15, keyPrefix: 'email-verify', failClosed: true }));
  app.use('/api/auth/email/verify-register', rateLimit({ windowSeconds: 300, maxRequests: 15, keyPrefix: 'email-verify-register', failClosed: true }));
  app.use('/api/auth/email/resend', rateLimit({ windowSeconds: 300, maxRequests: 10, keyPrefix: 'email-resend', failClosed: true }));
  // 登录前免登录验证（verify-guest）/重发（resend-guest）：验证码即凭据 + failClosed 限流防爆破/邮件轰炸
  app.use('/api/auth/email/verify-guest', rateLimit({ windowSeconds: 300, maxRequests: 15, keyPrefix: 'email-verify-guest', failClosed: true }));
  app.use('/api/auth/email/resend-guest', rateLimit({ windowSeconds: 300, maxRequests: 10, keyPrefix: 'email-resend-guest', failClosed: true }));
  // 责令换邮箱流程（change_token 半登录态）：request 会向「任意新邮箱」发信，保持相对严格防邮件轰炸；
  // confirm 只做验证码校验，放宽到与其它 verify 同级
  app.use('/api/auth/email/change-guest/request', rateLimit({ windowSeconds: 300, maxRequests: 8, keyPrefix: 'change-request', failClosed: true }));
  app.use('/api/auth/email/change-guest/confirm', rateLimit({ windowSeconds: 300, maxRequests: 15, keyPrefix: 'change-confirm', failClosed: true }));
  // 修改密码（当前密码一步直改）：10 次/10 分钟防当前密码爆破（该端点已要求登录态）
  app.use('/api/auth/password', rateLimit({ windowSeconds: 600, maxRequests: 10, keyPrefix: 'password-change', failClosed: true }));
  // 忘记密码 / 重置：10 次、15 次每 5 分钟（防验证码爆破/邮件轰炸）
  app.use('/api/auth/forgot', rateLimit({ windowSeconds: 300, maxRequests: 10, keyPrefix: 'forgot', failClosed: true }));
  app.use('/api/auth/reset', rateLimit({ windowSeconds: 300, maxRequests: 15, keyPrefix: 'reset', failClosed: true }));
  // 生成邀请码：防批量刷码（每人同时最多 1 个未使用，接口限流兜底）
  app.use('/api/auth/invites', rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'invites' }));
  // 需认证的子路径在 handler 中用 use() 加中间件
  app.route('/api/auth', authHandler);

  // AI 内容审核代理 — 需登录（handler 内 requireAuth），限流防滥用
  app.use('/api/review-content', rateLimit({ windowSeconds: 60, maxRequests: 20, keyPrefix: 'review' }));
  app.route('/api/review-content', reviewHandler);

  // 巡查体系（admin + moderator）：单帖预览队列 + 多人复核制
  app.route('/api/moderation', moderationHandler);

  // Posts — 列表和详情公开 (optionalAuth)，创建/编辑/删除需登录
  app.use('/api/posts*', optionalAuth);
  app.route('/api/posts', postsHandler);

  // Comments — 列表公开，创建需登录
  app.use('/api/comments*', optionalAuth);
  app.route('/api/comments', commentsHandler);

  // Categories — 公开
  app.route('/api/categories', categoriesHandler);

  // Likes — 需登录
  app.use('/api/likes*', requireAuth);
  app.route('/api/likes', likesHandler);

  // Upload — 需登录（父级 /api/upload* 通配符在 Hono 中不匹配子路径，
  // 鉴权在 handler 内 upload.use('*', requireAuth) 完成），限流防滥用
  // 30 次/分钟：一次发帖粘贴十几张图属正常操作，原 10 次会误伤
  app.use('/api/upload/*', rateLimit({ windowSeconds: 60, maxRequests: 30, keyPrefix: 'upload' }));
  app.route('/api/upload', uploadHandler);

  // Users — profile 公开，修改需登录
  app.route('/api/users', usersHandler);

  // Admin — 需登录；具体角色权限由 admin handler 内路径守卫控制
  //（admin 全部，moderator 仅 posts/comments/reports 管理）
  app.use('/api/admin*', requireAuth);
  app.route('/api/admin', adminHandler);

  // Stats — 记录浏览公开，查询需登录
  app.route('/api/stats', statsHandler);

  // Coins — 需登录
  app.use('/api/coins*', requireAuth);
  app.route('/api/coins', coinsHandler);

  // Check-In — 需登录
  app.use('/api/check-in*', requireAuth);
  app.route('/api/check-in', checkInHandler);

  // VIP — 需登录
  app.use('/api/vip*', requireAuth);
  app.route('/api/vip', vipHandler);
  // Reports — 需登录（handler 内 requireAuth）；提交举报限流防刷屏
  app.use('/api/reports/*', rateLimit({ windowSeconds: 60, maxRequests: 20, keyPrefix: 'report' }));
  app.use('/api/reports*', requireAuth);
  app.route('/api/reports', reportsHandler);

  // Appeals — 已下架复审（申诉提交/列表/判定均需登录；等级门槛在 handler 内校验）
  app.use('/api/appeals*', requireAuth);
  app.route('/api/appeals', appealsHandler);

  // Follows — 无需全局 auth（每条路由自己处理）
  app.route('/api/follows', followsHandler);


  // Notifications — 需登录
  app.use('/api/notifications*', requireAuth);
  app.route('/api/notifications', notificationsHandler);

  // Bookmarks — 需登录
  app.use('/api/bookmarks*', requireAuth);
  app.route('/api/bookmarks', bookmarksHandler);

  // ===== 积分扩展 =====

  // 商城 — handler 内部按路由自行判断是否需要登录
  app.route('/api/shop', shopHandler);

  // 帖子装饰 — 需登录
  app.use('/api/decorations*', requireAuth);
  app.route('/api/decorations', decorationsHandler);

  // 打赏 — 需登录
  app.use('/api/tips*', requireAuth);
  app.route('/api/tips', tipsHandler);

  // 积分抽奖 — 需登录
  app.use('/api/lottery-coins*', requireAuth);
  app.route('/api/lottery-coins', lotteryCoinsHandler);

  // 排行榜 — 公开
  app.route('/api/leaderboard', leaderboardHandler);

  // 自赎 + 管理审核 — 需登录
  app.use('/api/unban*', requireAuth);
  app.route('/api/unban', unbanHandler);

  // 道具系统 — 需登录
  app.use('/api/items*', requireAuth);
  app.route('/api/items', itemsHandler);

  // Push 通知 — 需登录
  app.use('/api/push*', requireAuth);
  app.route('/api/push', pushHandler);

  // ===== 经济系统 v3 =====

  // 每日任务 — 需登录
  app.use('/api/tasks*', requireAuth);
  app.route('/api/tasks', tasksHandler);

  // 成就墙 — 公开（登录时显示解锁状态，handler 内用 optionalAuth）
  app.route('/api/achievements', achievementsHandler);

  // 感谢 — 需登录
  app.use('/api/thanks*', requireAuth);
  app.route('/api/thanks', thanksHandler);

}
