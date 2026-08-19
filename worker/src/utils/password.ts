// 密码哈希: 新用户用 Web Crypto (PBKDF2)，兼容旧 bcryptjs 哈希
// bcryptjs 在 Workers 中模块加载会失败，所以用 deferred import

const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const SALT_LENGTH = 32;

function base64Encode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64Decode(str: string): Uint8Array {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

function getRandomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const result = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8
  );

  return new Uint8Array(result);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = getRandomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt);
  return `${base64Encode(salt)}.${base64Encode(key)}`;
}

export interface PasswordVerifyResult {
  valid: boolean;
  /** bcrypt 旧哈希验证通过，调用方应将密码升级为 PBKDF2 */
  needsUpgrade?: boolean;
}

export async function verifyPassword(password: string, hash: string): Promise<PasswordVerifyResult> {
  // 兼容 bcryptjs 旧哈希 ($2a$, $2b$, $2y$)
  if (hash.startsWith('$2')) {
    try {
      // Workers 中动态加载 bcryptjs，成功则验证并返回结果
      const bcrypt = await import('bcryptjs');
      const valid = await bcrypt.compare(password, hash);
      if (valid) {
        // 验证通过后返回特殊标记，由调用方升级为 PBKDF2
        return { valid: true, needsUpgrade: true };
      }
      return { valid: false };
    } catch {
      // bcryptjs 无法加载（Workers 环境常见），拒绝登录
      return { valid: false };
    }
  }

  // Web Crypto PBKDF2 新哈希 (格式: base64salt.base64key)
  const [saltB64, keyB64] = hash.split('.');
  if (!saltB64 || !keyB64) return { valid: false };

  try {
    const salt = base64Decode(saltB64);
    const expectedKey = base64Decode(keyB64);
    const actualKey = await deriveKey(password, salt);

    if (actualKey.length !== expectedKey.length) return { valid: false };

    // 恒定时间比较
    let diff = 0;
    for (let i = 0; i < actualKey.length; i++) {
      diff |= actualKey[i] ^ expectedKey[i];
    }
    return { valid: diff === 0 };
  } catch {
    return { valid: false };
  }
}

export function generateCode(length: number = 6): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  const buf = getRandomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[buf[i] % chars.length];
  }
  return code;
}
