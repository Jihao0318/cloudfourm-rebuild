import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { isSafeFetchUrl } from '../utils/validation';

// AI 内容审核代理：审核密钥（JUDGE_API_KEY）与审核服务地址（JUDGE_API_URL，完整 /api/judge 端点）
// 均从 worker secret 读取，供前端 reviewPostContent 调用。
// 出站通道：配置了 JUDGE service binding 时走绑定内网（同账号 worker 公网互调被 CF 1042 拒绝），
// 未绑定走公网 fetch（自定义域名不受限）。judge 协议：{verdict:'pass'|'flag', confidence, reasons, summary}。
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
  // 审核地址安全校验：非 http/https 或指向内网/环回 → 视为配置错误，放行并记日志（不盲发）
  if (!isSafeFetchUrl(c.env.JUDGE_API_URL)) {
    console.error('[review] JUDGE_API_URL 指向不安全地址，跳过审核放行');
    return c.json({ success: true, data: { allowed: true } });
  }

  try {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-judge-key': c.env.JUDGE_API_KEY },
      // judge 协议要求 title/content 两个字段；同步端点只有正文，title 传空串
      body: JSON.stringify({ title: '', content }),
      // 5 秒超时：审核服务挂起时不无限等待，超时走下方 catch → fail-open 放行
      signal: AbortSignal.timeout(5000),
    };
    // 双通道：JUDGE binding 优先（内网，绕开 1042）；binding 5xx/异常回退公网；未配置走公网 fetch
    let res: Response;
    if (c.env.JUDGE) {
      try {
        const bindingRes = await c.env.JUDGE.fetch(new Request(c.env.JUDGE_API_URL, init));
        res = bindingRes.status < 500 ? bindingRes : await fetch(c.env.JUDGE_API_URL, init);
      } catch {
        res = await fetch(c.env.JUDGE_API_URL, init);
      }
    } else {
      res = await fetch(c.env.JUDGE_API_URL, init);
    }
    // 密钥错误 / 审核服务异常 → 放行（fail-open 语义保持）
    if (res.status === 401) return c.json({ success: true, data: { allowed: true } });
    const data: any = await res.json();
    if (data.status === 'error') return c.json({ success: true, data: { allowed: true } });

    if (data.verdict === 'flag') {
      // 只返回原因本体：前端 reviewPostContent 会拼「审核未通过：」前缀，这里不再重复拼接
      const detail = (typeof data.summary === 'string' && data.summary.trim())
        || (Array.isArray(data.reasons) && data.reasons.length > 0 ? data.reasons.filter((r: unknown) => typeof r === 'string').join('；') : '')
        || '内容疑似违规';
      return c.json({ success: true, data: { allowed: false, reason: detail } });
    }
    return c.json({ success: true, data: { allowed: true } });
  } catch (err: any) {
    console.error('[review] 审核服务异常，放行:', err?.message);
    return c.json({ success: true, data: { allowed: true } });
  }
});

export default review;
