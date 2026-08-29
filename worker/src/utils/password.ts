// 密码哈希：双格式兼容
// - 旧格式 saltB64.hashB64（PBKDF2-SHA256 / 100k 迭代，老库存量哈希）
// - 新格式 pbkdf2$<iterations>$<saltB64>$<hashB64>（自描述迭代次数，便于后续平滑调参）
// 两种格式统一走下方 derive() 核心派生；旧格式验证通过后由登录处透明重哈希升级为新格式

const ITERATIONS = 100000; // 新哈希默认迭代次数（与旧格式一致，避免登录时延突增）
const SALT_LENGTH = 16; // 新格式盐长度（字节）
const HASH_LENGTH = 32; // 新格式派生长度（字节）

// 手工 base64 编解码：btoa/atob 只接受 binary string，需逐字节 String.fromCharCode 转换
// （不能用 ...spread 直接展开 Uint8Array，数组一大就爆调用栈）
function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function fromB64(str: string): Uint8Array {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function getRandomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

// 恒定时间比较：长度不等直接 false（长度不是秘密），内容异或累积后统一判定，
// 避免逐字节提前返回泄露匹配前缀长度
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// 核心派生：dkLen 按需（PBKDF2 截断等价：同(password,salt,iterations)下 dkLen=N 的前 N 字节 == dkLen=32 的前 N 字节）
async function derive(password: string, salt: Uint8Array, iterations: number, dkLen = 32): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, dkLen * 8);
}

// 新格式哈希：随机 16 字节盐 + 100k 迭代，产出自描述格式 pbkdf2$<iterations>$<saltB64>$<hashB64>
export async function hashPassword(password: string): Promise<string> {
  const salt = getRandomBytes(SALT_LENGTH);
  const dk = new Uint8Array(await derive(password, salt, ITERATIONS, HASH_LENGTH));
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(dk)}`;
}

// 旧格式（saltB64.hashB64）三态验证：boolean = 旧格式且已比对；null = 非旧格式（调用方继续尝试新格式）
async function verifyLegacy(password: string, stored: string): Promise<boolean | null> {
  // 无 '.'（-1）或 '.' 在首位（空盐）都视为非旧格式；含 '$' 说明是新格式（pbkdf2$…），交给后续分支
  if (stored.indexOf('.') <= 0 || stored.includes('$')) return null;
  const dot = stored.indexOf('.');
  try {
    const salt = fromB64(stored.slice(0, dot));
    const expected = fromB64(stored.slice(dot + 1));
    if (salt.length === 0 || expected.length === 0) return false;
    // 按存储哈希的实际字节长派生（老库哈希可能非 32 字节，绝不能写死 dkLen；
    // 依赖 PBKDF2 截断等价：前 N 字节与全量派生完全一致）
    const actual = new Uint8Array(await derive(password, salt, 100000, expected.length));
    return constantTimeEqual(actual, expected);
  } catch {
    return false; // base64 非法等解析异常一律按验证失败处理，不抛
  }
}

export interface PasswordVerifyResult {
  valid: boolean;
  /** 兼容保留字段：现实现恒不设置；旧 '.' 格式哈希的升级由登录处按格式判断透明完成 */
  needsUpgrade?: boolean;
}

// 双格式验证：先试旧格式（非 null 直接返回），再解析新 pbkdf2$ 四段格式；非法格式返回 false 不抛
export async function verifyPassword(password: string, hash: string): Promise<PasswordVerifyResult> {
  const legacy = await verifyLegacy(password, hash);
  if (legacy !== null) return { valid: legacy };

  // 新格式 pbkdf2$<iterations>$<saltB64>$<hashB64>：必须恰好四段且首段为 pbkdf2
  const parts = hash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return { valid: false };
  const iterations = Number(parts[1]);
  // iterations 校验：必须是 ≥1 的整数，防御脏数据（0/负数/小数/非数字直接判失败）
  if (!Number.isInteger(iterations) || iterations < 1) return { valid: false };

  try {
    const salt = fromB64(parts[2]);
    const expected = fromB64(parts[3]);
    if (salt.length === 0 || expected.length === 0) return { valid: false };
    const actual = new Uint8Array(await derive(password, salt, iterations, expected.length));
    return { valid: constantTimeEqual(actual, expected) };
  } catch {
    return { valid: false }; // base64 非法等解析异常一律按验证失败处理，不抛
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
