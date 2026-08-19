import { SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from '../types';

const getSecret = (secret: string) => new TextEncoder().encode(secret);

/**
 * 校验 JWT_SECRET 是否配置且足够强度。
 * 拒绝静默 fallback 到弱密钥。
 */
function requireSecret(secret: string): string {
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET 未配置或长度不足，拒绝签发/验证 token');
  }
  return secret;
}

export async function createToken(payload: JWTPayload, secret: string): Promise<string> {
  const key = requireSecret(secret);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret(key));
}

export async function verifyToken(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const key = requireSecret(secret);
    const { payload } = await jwtVerify(token, getSecret(key));
    return payload as unknown as JWTPayload;
  } catch (err) {
    return null;
  }
}

// ===== Refresh Token =====
// refresh token 是用 crypto.getRandomValues 生成的不透明字符串，不编码 payload
// 后端只存 sha256 哈希，泄露也无法伪造

export function createRefreshToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashRefreshToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// access token 短期有效（15 分钟）
export async function createAccessToken(payload: JWTPayload, secret: string): Promise<string> {
  const key = requireSecret(secret);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(getSecret(key));
}
