export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateUsername(username: string): ValidationResult {
  if (!username || username.length < 3 || username.length > 20) {
    return { valid: false, error: '用户名长度应为 3-20 个字符' };
  }
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) {
    return { valid: false, error: '用户名只能包含字母、数字、下划线和中文' };
  }
  return { valid: true };
}

export function validateEmail(email: string): ValidationResult {
  if (!email || email.length > 255) {
    return { valid: false, error: '请输入有效的邮箱地址' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: '邮箱格式不正确' };
  }
  if (!email.toLowerCase().endsWith('@qq.com')) {
    return { valid: false, error: '仅支持 QQ 邮箱注册' };
  }
  const localPart = email.split('@')[0];
  if (!/^\d{5,11}$/.test(localPart)) {
    return { valid: false, error: '请输入真实QQ号' };
  }
  return { valid: true };
}

export function validatePassword(password: string): ValidationResult {
  if (!password || password.length < 6 || password.length > 128) {
    return { valid: false, error: '密码长度应为 6-128 个字符' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: '密码必须包含至少一个大写字母' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: '密码必须包含至少一个数字' };
  }
  return { valid: true };
}

export function validatePostTitle(title: string): ValidationResult {
  if (!title || title.length < 1 || title.length > 200) {
    return { valid: false, error: '标题长度应为 1-200 个字符' };
  }
  return { valid: true };
}

export function validateContent(content: string): ValidationResult {
  if (!content || content.length < 1 || content.length > 100000) {
    return { valid: false, error: '内容长度应为 1-100000 个字符' };
  }
  return { valid: true };
}

/**
 * 安全解析路由参数中的数字 ID。
 * 传入非数字或非正数时返回 null，避免 NaN 进入 SQL。
 */
export function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 服务端对外发起请求前的 URL 安全校验：
 * 仅允许 http/https；拒绝 localhost、环回、私有与保留地址（防 SSRF 转向内网）。
 * 用于审核服务地址等来自配置（secret/var）的出站 URL——配置被误填时快速失败而非盲发。
 */
export function isSafeFetchUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  // 域名形式：localhost / 本地后缀
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  // IPv4 点分形式：拒绝环回 / 私有 / 链路本地 / 保留段
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false; // 本网络 / 私有 / 环回
    if (a === 169 && b === 254) return false; // 链路本地
    if (a === 172 && b >= 16 && b <= 31) return false; // 私有
    if (a === 192 && b === 168) return false; // 私有
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // 组播与保留
    return true;
  }
  // IPv6 括号形式：环回 / 唯一本地（fc/fd）/ 链路本地（fe80）
  if (host.startsWith('[')) {
    if (host === '[::1]' || host === '[::]') return false;
    const h = host.slice(1, -1);
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return false;
    return true;
  }
  return true;
}
