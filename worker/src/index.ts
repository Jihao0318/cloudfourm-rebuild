import { Hono } from 'hono';
import type { Env } from './types';
import { setupRoutes } from './routes';
import { cleanupUser } from './middleware/auth';
import { cleanupOldPageViews, hardDeletePost } from './db/queries';
import { cleanupTransactions } from './handlers/coins';
import { recalculateLeaderboard } from './handlers/leaderboard';
import { consumeAiReviewBatch } from './aiReview';

const app = new Hono<{ Bindings: Env }>();

// 设置所有路由
setupRoutes(app);

// 404 处理
app.notFound((c) => {
  return c.json({ success: false, error: '接口不存在' }, 404);
});

// 全局错误处理
app.onError((err, c) => {
  console.error('Worker Error:', err);
  return c.json({ success: false, error: '服务器内部错误' }, 500);
});

// 读取后台配置（带默认值）
async function settingInt(db: D1Database, key: string, def: number, min = 0, max = 100000): Promise<number> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  const n = parseInt(row?.value || '');
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

// 打回超时（1 天）软删：扣积分 + 通知作者（软删帖由下方保留期任务统一硬删）
async function purgeExpiredRejected(db: D1Database, nowStr: string): Promise<number> {
  const coins = await settingInt(db, 'review_reject_coins', 50);
  // 打回超过 1 天未修改的帖子 → 软删 + 再扣打回扣分 + 通知
  const rows = await db
    .prepare("SELECT id, user_id FROM posts WHERE review_status = 'rejected' AND rejected_at IS NOT NULL AND rejected_at <= datetime(?, '-1 day') AND deleted_at IS NULL")
    .bind(nowStr)
    .all<{ id: number; user_id: number }>();
  for (const r of rows.results || []) {
    try {
      await db.batch([
        db.prepare("UPDATE posts SET deleted_at = datetime('now') WHERE id = ?").bind(r.id),
        db.prepare('UPDATE user_balances SET coins = MAX(0, coins - ?), total_spent = total_spent + ? WHERE user_id = ?').bind(coins, coins, r.user_id),
        db.prepare("INSERT INTO coin_transactions (user_id, type, amount, balance_after, description) SELECT ?, 'admin', ?, coins, ? FROM user_balances WHERE user_id = ?")
          .bind(r.user_id, -coins, '帖子打回超时未修改，已被删除', r.user_id),
        db.prepare("INSERT INTO notifications (user_id, type, post_id, content, read) VALUES (?, 'post_takedown', ?, ?, 0)")
          .bind(r.user_id, r.id, '你的帖子因打回后 1 天内未修改，已被删除'),
      ]);
    } catch (e) {
      console.error(`scheduled purge rejected post ${r.id} failed:`, e);
    }
  }
  return (rows.results || []).length;
}

// 软删到期硬删：超过保留期（默认 30 天，后台可配 soft_delete_retention_days）的软删帖物理清除
async function purgeExpiredSoftDeleted(db: D1Database, nowStr: string): Promise<number> {
  const days = await settingInt(db, 'soft_delete_retention_days', 30, 1, 3650);
  const rows = await db
    .prepare('SELECT id FROM posts WHERE deleted_at IS NOT NULL AND deleted_at <= datetime(?, ?)')
    .bind(nowStr, `-${days} days`)
    .all<{ id: number }>();
  for (const r of rows.results || []) {
    try {
      await hardDeletePost(db, r.id);
    } catch (e) {
      console.error(`scheduled hard delete post ${r.id} failed:`, e);
    }
  }
  return (rows.results || []).length;
}

// 安全日志清理：审计日志（登录/注册/改密/邮箱变更等）只写不删，需按保留期兜底。
// 保留 90 天：足以满足安全审计回溯需求，又不会让表无限膨胀（每次轮换/注册都写一行）。
// 按 created_at 过滤，走 idx_security_logs_created(created_at) 索引
async function purgeOldSecurityLogs(db: D1Database): Promise<number> {
  const res = await db.prepare("DELETE FROM security_logs WHERE created_at < datetime('now', '-90 days')").run();
  return res.meta.changes || 0;
}

// 限流计数清理：限流中间件按 IP×前缀 UPSERT 的行只在窗口期内有意义，
// 过期（expires_at < 当前时间）后即可删除，避免 rate_limits 只增不删无限膨胀。
// 按 expires_at 过滤，走 idx_rate_limits_expires(expires_at) 索引
async function purgeExpiredRateLimits(db: D1Database): Promise<number> {
  const res = await db.prepare("DELETE FROM rate_limits WHERE expires_at < datetime('now')").run();
  return res.meta.changes || 0;
}

// 通知清理：只删「已读」且超过 30 天的通知——未读通知一律保留（用户可能还没看到），
// 已读通知超过 30 天后基本没有召回价值，删掉控制膨胀。
// read = 1 + created_at 范围走 idx_notifications_user(user_id, read, created_at DESC)
// 的 read 前缀列与 created_at 范围部分（部分索引 idx_notifications_unread 只覆盖未读，与此无关）
async function purgeOldNotifications(db: D1Database): Promise<number> {
  const res = await db.prepare("DELETE FROM notifications WHERE read = 1 AND created_at < datetime('now', '-30 days')").run();
  return res.meta.changes || 0;
}

// 导出 fetch handler — Cloudflare Worker 入口
export default {
  fetch: app.fetch,

  // 定期清理（每日 00:00 UTC）：
  // 1. 注销冷静期（3 天）到期的账号（requireAuth 懒触发之外的后台兜底）
  // 2. 打回超时（1 天）未修改的帖子 → 软删 + 扣分 + 通知
  // 3. 超过保留期（默认 30 天）的软删帖 → 物理删除（hardDeletePost 含红包退款）
  // 4. 超过 90 天的安全日志 → 删除（防 security_logs 无限膨胀）
  // 5. 已过期的限流计数 → 删除（防 rate_limits 无限膨胀）
  // 6. 已读且超过 30 天的通知 → 删除（未读通知保留）
  // 7. coin_transactions 全表按用户收敛（保留最近 15 条 + 当日记录，原高频写路径 5% 概率触发已移除）
  // 8. 90 天前的 page_views 清理（原浏览路径 1% 概率触发已移除）
  // 9. 排行榜物化表重算（排名滞后 ≤24h）
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      try {
        const rows = await env.DB
          .prepare('SELECT id FROM users WHERE scheduled_deleted_at IS NOT NULL AND scheduled_deleted_at <= ?')
          .bind(nowStr)
          .all<{ id: number }>();
        for (const r of rows.results || []) {
          try {
            await cleanupUser(env.DB, r.id);
          } catch (e) {
            console.error(`scheduled cleanup user ${r.id} failed:`, e);
          }
        }
        if ((rows.results || []).length > 0) {
          console.log(`scheduled cleanup: purged ${rows.results.length} expired accounts`);
        }
      } catch (e) {
        console.error('scheduled cleanup error:', e);
      }
      try {
        const rejected = await purgeExpiredRejected(env.DB, nowStr);
        if (rejected > 0) console.log(`scheduled cleanup: purged ${rejected} rejected posts (timeout)`);
      } catch (e) {
        console.error('scheduled purge rejected error:', e);
      }
      try {
        const hardDeleted = await purgeExpiredSoftDeleted(env.DB, nowStr);
        if (hardDeleted > 0) console.log(`scheduled cleanup: hard deleted ${hardDeleted} soft-deleted posts`);
      } catch (e) {
        console.error('scheduled hard delete error:', e);
      }
      try {
        const logPurged = await purgeOldSecurityLogs(env.DB);
        if (logPurged > 0) console.log(`scheduled cleanup: purged ${logPurged} old security logs (>90 days)`);
      } catch (e) {
        console.error('scheduled purge security logs error:', e);
      }
      try {
        const ratePurged = await purgeExpiredRateLimits(env.DB);
        if (ratePurged > 0) console.log(`scheduled cleanup: purged ${ratePurged} expired rate limits`);
      } catch (e) {
        console.error('scheduled purge rate limits error:', e);
      }
      try {
        const notifPurged = await purgeOldNotifications(env.DB);
        if (notifPurged > 0) console.log(`scheduled cleanup: purged ${notifPurged} read notifications (>30 days)`);
      } catch (e) {
        console.error('scheduled purge notifications error:', e);
      }
      try {
        await cleanupTransactions(env.DB);
        console.log('scheduled cleanup: coin transactions converged (per-user keep 15 + today)');
      } catch (e) {
        console.error('scheduled cleanup coin transactions error:', e);
      }
      try {
        await cleanupOldPageViews(env.DB);
        console.log('scheduled cleanup: purged old page views (>90 days)');
      } catch (e) {
        console.error('scheduled purge old page views error:', e);
      }
      try {
        await recalculateLeaderboard(env.DB);
        console.log('scheduled cleanup: leaderboard cache recalculated');
      } catch (e) {
        console.error('scheduled recalculate leaderboard error:', e);
      }
    })());
  },

  // AI 异步审核消费端（队列 forum-ai-review）：逐条审核新帖（读帖 → 调 judge → flag 置 questionable + 通知作者）；
  // 失败抛出让该批消息走队列重试（max_retries=3），连续失败熔断逻辑见 aiReview.ts
  async queue(batch: MessageBatch<{ postId: number }>, env: Env, _ctx: ExecutionContext) {
    await consumeAiReviewBatch(batch, env);
  },
};
