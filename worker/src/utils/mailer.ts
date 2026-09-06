// 邮件发送工具：通过 mailer 服务发信
// 凭据从 env 读取（MAILER_URL / MAILER_TOKEN），源码不落明文
import type { Env } from '../types';

export interface MailPayload {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
}

// 私网/环回/保留地址黑名单（URL 来自 env 配置，非用户输入；此处为配置错误兜底）
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^0\.0\.0\.0$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^[0-9a-f:]+$/.test(h) && h.includes(':')) return true; // IPv6（含 ::1）
  return false;
}

export async function sendMail(ctx: { env: Env }, payload: MailPayload): Promise<{ ok: boolean; error?: string }> {
  const url = ctx.env.MAILER_URL;
  const token = ctx.env.MAILER_TOKEN;
  if (!url || !token) return { ok: false, error: '邮件服务未配置' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: '邮件服务地址无效' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, error: '邮件服务仅支持 https' };
  if (isBlockedHost(parsed.hostname)) return { ok: false, error: '邮件服务地址不合法' };

  try {
    // 双通道：MAILER service binding 优先（同账号 worker 公网互调被 CF 1042 拒绝，必须内网）；
    // binding 返回 5xx 或抛错时回退公网 URL 重试一次；未配置 binding 走公网
    const callViaBinding = async (): Promise<Response> => {
      if (!ctx.env.MAILER) throw new Error('MAILER binding 未配置');
      return ctx.env.MAILER.fetch(new Request(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      }));
    };
    let res: Response;
    try {
      if (ctx.env.MAILER) {
        const bindingRes = await callViaBinding();
        if (bindingRes.status < 500) {
          res = bindingRes;
        } else {
          console.error('[mailer] binding 5xx，回退公网:', bindingRes.status);
          res = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000),
          });
        }
      } else {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });
      }
    } catch (bindingErr: any) {
      if (bindingErr?.message === 'MAILER binding 未配置') throw bindingErr;
      console.error('[mailer] binding 调用失败，回退公网:', bindingErr?.message);
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok && (data as any)?.ok) return { ok: true };
    return { ok: false, error: (data as any)?.error || `邮件服务返回 ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: `邮件发送失败: ${err.message}` };
  }
}
