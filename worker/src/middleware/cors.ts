import { Context, Next } from 'hono';
import type { Env } from '../types';

export async function cors(c: Context<{ Bindings: Env }>, next: Next) {
  const requestOrigin = c.req.header('Origin');
  const configured = c.env.FRONTEND_URL;

  // 无 Origin 头（同源请求 / curl）→ 不设 CORS 头，直接放行
  if (requestOrigin) {
    // FRONTEND_URL 未配置 → 回显请求 Origin（向后兼容本地开发）
    if (!configured) {
      c.header('Access-Control-Allow-Origin', requestOrigin);
    } else {
      // 白名单：FRONTEND_URL 逗号分隔多域名；localhost 开发放行保留
      const allowList = configured.split(',').map((s) => s.trim()).filter(Boolean);
      const allowed = allowList.includes(requestOrigin) || /^https?:\/\/localhost(:\d+)?$/.test(requestOrigin);
      if (!allowed) {
        // 非白名单来源：明确拒绝，不再回显
        return c.json({ success: false, error: '来源不被允许' }, 403);
      }
      c.header('Access-Control-Allow-Origin', requestOrigin);
    }
    // 响应随 Origin 变化，命中缓存的响应需按 Origin 区分
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.header('Access-Control-Max-Age', '86400');
  }

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  // 安全响应头
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  c.header('Content-Type', 'application/json; charset=utf-8');

  await next();
}