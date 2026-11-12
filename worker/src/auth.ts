// 익명 계정 (사양서 6.6 대신, M6 결정: Cloudflare만): 첫 실행에 폰 열쇠(무작위 256비트)를 발급하고,
// 서버에는 그 SHA-256 값만 저장한다. 요청마다 Authorization: Bearer <폰 열쇠>로 사용자를 찾는다.
import { HttpError } from './http';

/** 같은 IP에서 1시간에 만들 수 있는 계정 수 (남용 방지) */
export const SIGNUP_LIMIT_PER_HOUR = 10;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validNickname(v: unknown): string {
  if (typeof v !== 'string') throw new HttpError(400, '닉네임이 없습니다');
  const n = v.trim();
  if (n.length < 1 || n.length > 20) throw new HttpError(400, '닉네임은 1~20자');
  return n;
}

export async function signup(env: Cloudflare.Env, nickname: string, ip: string, now = Date.now()): Promise<{ userId: string; token: string }> {
  const hourAgo = now - 3_600_000;
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM signup_log WHERE ip = ? AND at > ?').bind(ip, hourAgo).first<{ n: number }>();
  if ((recent?.n ?? 0) >= SIGNUP_LIMIT_PER_HOUR) throw new HttpError(429, '잠시 뒤 다시 시도해 주세요');
  const userId = crypto.randomUUID();
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const iso = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, nickname, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(userId, nickname, await sha256Hex(token), iso, iso),
    env.DB.prepare('INSERT INTO signup_log (ip, at) VALUES (?, ?)').bind(ip, now),
    env.DB.prepare('DELETE FROM signup_log WHERE at < ?').bind(now - 86_400_000),
  ]);
  return { userId, token };
}

/** 요청의 폰 열쇠로 사용자 ID를 찾는다. 없거나 틀리면 401 */
export async function authenticate(req: Request, env: Cloudflare.Env): Promise<string> {
  const auth = req.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token.length < 20 || token.length > 200) throw new HttpError(401, '로그인 필요');
  const row = await env.DB.prepare('SELECT id FROM users WHERE token_hash = ?').bind(await sha256Hex(token)).first<{ id: string }>();
  if (!row) throw new HttpError(401, '로그인 필요');
  return row.id;
}
