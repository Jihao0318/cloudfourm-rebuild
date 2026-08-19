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
