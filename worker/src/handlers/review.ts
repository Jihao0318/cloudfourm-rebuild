import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../middleware/auth';

// AI 内容审核代理：审核密钥（JUDGE_API_KEY）与审核服务地址（JUDGE_API_URL，完整 /api/judge 端点）
// 均从 worker secret/var 读取，供前端 reviewPostContent 调用。判定语义与旧前端实现保持一致。
const review = new Hono<{ Bindings: Env }>();

review.post('/', requireAuth, async (c) => {
  // 长度校验（<=2000 字符，与发帖正文限制一致）
  let content = '';
  try {
    const body = await c.req.json<{ content?: unknown }>();
    content = typeof body?.content === 'string' ? body.content.trim() : '';
  } catch {
    return c.json({ success: false, error: '请求体解析失败' }, 400);
  }
  if (!content) return c.json({ success: false, error: '内容不能为空' }, 400);
  if (content.length > 2000) return c.json({ success: false, error: '内容不能超过 2000 字' }, 400);

  // 密钥或审核地址未配置 → 放行（fail-open，保证发帖体验）
  if (!c.env.JUDGE_API_KEY || !c.env.JUDGE_API_URL) return c.json({ success: true, data: { allowed: true } });

  try {
    const res = await fetch(c.env.JUDGE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-judge-key': c.env.JUDGE_API_KEY },
      body: JSON.stringify({ content }),
      // 5 秒超时：审核服务挂起时不无限等待，超时走下方 catch → fail-open 放行
      signal: AbortSignal.timeout(5000),
    });
    // 密钥错误 / 审核服务异常 → 放行（与旧前端 reviewPostContent 的 fail-open 语义一致）
    if (res.status === 401) return c.json({ success: true, data: { allowed: true } });
    const data: any = await res.json();

    if (data.status === 'reject') {
      // 只返回原因本体：前端 api.ts reviewPostContent 会拼「审核未通过：」前缀，
      // 这里不再重复拼接，避免出现「审核未通过：审核未通过：xxx」的双重前缀
      let detail = '';
      if (Array.isArray(data.violations) && data.violations.length > 0) {
        detail = data.violations.map((v: any) => {
          const reason = (v.reason || '').replace(/^[\d\s、.，,：:]+/, ''); // 去掉 AI 可能混入的编号和符号
          return `${reason}（${v.violation_phrase || ''}）`;
        }).join('；');
      } else {
        const reason = data.reason || '内容违规';
        detail = `${reason}${data.violation_phrase ? `（${data.violation_phrase}）` : ''}`;
      }
      return c.json({ success: true, data: { allowed: false, reason: detail } });
    }
    return c.json({ success: true, data: { allowed: true } });
  } catch (err: any) {
    console.error('[review] 审核服务异常，放行:', err?.message);
    return c.json({ success: true, data: { allowed: true } });
  }
});

export default review;