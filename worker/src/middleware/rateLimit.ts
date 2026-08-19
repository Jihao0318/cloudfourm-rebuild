import { Context, Next } from 'hono';
import type { Env } from '../types';

export function rateLimit(opts: { windowSeconds: number; maxRequests: number; keyPrefix: string; failClosed?: boolean }) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    const key = `ratelimit:${opts.keyPrefix}:${ip}`;

    try {
      const db = c.env.DB;
      // 原子计数：单条 UPSERT 完成累加，无 SELECT→UPDATE 竞态。
      // 活跃行 → count+1（保持原窗口）；过期/不存在行 → 重置 count=1 并刷新窗口（惰性清理，无需每次 DELETE）。
      await db
        .prepare(`
          INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, datetime('now', '+' || ? || ' seconds'))
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN rate_limits.expires_at > datetime('now') THEN rate_limits.count + 1 ELSE 1 END,
            expires_at = CASE WHEN rate_limits.expires_at > datetime('now') THEN rate_limits.expires_at ELSE excluded.expires_at END
        `)
        .bind(key, opts.windowSeconds)
        .run();

      const row = await db
        .prepare('SELECT count, expires_at FROM rate_limits WHERE key = ?')
        .bind(key)
        .first<{ count: number; expires_at: string }>();

      // 计数已含本次请求：超过 maxRequests 才拒绝（与旧实现的「第 maxRequests+1 次开始拒绝」行为一致）
      if (row && row.count > opts.maxRequests) {
        // Retry-After：距窗口过期的剩余秒数（向上取整，至少 1）
        const remaining = Math.max(1, Math.ceil((new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000));
        return c.json({ success: false, error: '请求过于频繁，请稍后再试' }, 429, { 'Retry-After': String(remaining) });
      }
    } catch (err) {
      if (opts.failClosed) {
        // 认证类端点：限流存储不可用时拒绝而非放行
        return c.json({ success: false, error: '服务暂时不可用，请稍后再试' }, 429);
      }
      console.error('[rateLimit] D1 异常，放行请求:', err);
    }

    await next();
  };
}
