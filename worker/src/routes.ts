import { Hono } from 'hono';
import type { Env } from './types';
import { cors } from './middleware/cors';
import { requireAuth, optionalAuth } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';

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

  // 公共系统设置（公告等）— 无需认证
  // announcement_updated_at 作为公告版本号：前端用它实现「每次更新公告重新提醒」
  app.get('/api/settings/public', async (c) => {
    const setting = await c.env.DB
      .prepare("SELECT value, updated_at FROM settings WHERE key = 'announcement'")
      .first<{ value: string; updated_at: string }>();
    return c.json({ success: true, data: { announcement: setting?.value || '', announcement_updated_at: setting?.updated_at || '' } });
  });

  // Auth — 无需认证: register/login/forgot/reset
  // 限流保护：认证端点 failClosed（D1 异常时拒绝而非放行），其余端点 fail-open
  app.use('/api/auth/login', rateLimit({ windowSeconds: 60, maxRequests: 5, keyPrefix: 'login', failClosed: true }));
  app.use('/api/auth/register', rateLimit({ windowSeconds: 3600, maxRequests: 3, keyPrefix: 'register', failClosed: true }));
  app.use('/api/auth/verify-password', rateLimit({ windowSeconds: 60, maxRequests: 5, keyPrefix: 'verify-password', failClosed: true }));
  app.use('/api/auth/account', rateLimit({ windowSeconds: 60, maxRequests: 3, keyPrefix: 'account' }));
  app.use('/api/auth/username', rateLimit({ windowSeconds: 60, maxRequests: 5, keyPrefix: 'username' }));
  app.use('/api/auth/cancel-deletion', rateLimit({ windowSeconds: 60, maxRequests: 5, keyPrefix: 'cancel-deletion' }));
  app.use('/api/auth/refresh', rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'refresh', failClosed: true }));
  // 邮箱/密码两步验证端点限流（防验证码爆破/邮件轰炸，全部 failClosed）
  app.use('/api/auth/email/request', rateLimit({ windowSeconds: 300, maxRequests: 5, keyPrefix: 'email-request', failClosed: true }));
  app.use('/api/auth/email/verify', rateLimit({ windowSeconds: 300, maxRequests: 5, keyPrefix: 'email-verify', failClosed: true }));
  app.use('/api/auth/email/verify-register', rateLimit({ windowSeconds: 300, maxRequests: 5, keyPrefix: 'email-verify-register', failClosed: true }));
  app.use('/api/auth/email/resend', rateLimit({ windowSeconds: 300, maxRequests: 3, keyPrefix: 'email-resend', failClosed: true }));
  // 登录前免登录验证（verify-guest）/重发（resend-guest）：验证码即凭据 + failClosed 限流防爆破/邮件轰炸
  app.use('/api/auth/email/verify-guest', rateLimit({ windowSeconds: 300, maxRequests: 5, keyPrefix: 'email-verify-guest', failClosed: true }));
  app.use('/api/auth/email/resend-guest', rateLimit({ windowSeconds: 300, maxRequests: 3, keyPrefix: 'email-resend-guest', failClosed: true }));
  app.use('/api/auth/password/request', rateLimit({ windowSeconds: 300, maxRequests: 5, keyPrefix: 'password-request', failClosed: true }));
  app.use('/api/auth/password/verify', rateLimit({ windowSeconds: 300, maxRequests: 5, keyPrefix: 'password-verify', failClosed: true }));
  app.use('/api/auth/password/resend', rateLimit({ windowSeconds: 300, maxRequests: 3, keyPrefix: 'password-resend', failClosed: true }));
  // 忘记密码：5 分钟 3 次（防验证码爆破/邮件轰炸）
  app.use('/api/auth/forgot', rateLimit({ windowSeconds: 300, maxRequests: 3, keyPrefix: 'forgot', failClosed: true }));
  app.use('/api/auth/reset', rateLimit({ windowSeconds: 300, maxRequests: 5, keyPrefix: 'reset', failClosed: true }));
  // 生成邀请码：防批量刷码（每人同时最多 1 个未使用，接口限流兜底）
  app.use('/api/auth/invites', rateLimit({ windowSeconds: 60, maxRequests: 5, keyPrefix: 'invites' }));
  // 需认证的子路径在 handler 中用 use() 加中间件
  app.route('/api/auth', authHandler);

  // AI 内容审核代理 — 需登录（handler 内 requireAuth），限流防滥用
  app.use('/api/review-content', rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'review' }));
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
  app.use('/api/upload/*', rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'upload' }));
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
  app.use('/api/reports/*', rateLimit({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'report' }));
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
