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

/** 가입 제한 (같은 IP에서 1시간에 SIGNUP_LIMIT_PER_HOUR개). 넘으면 429 */
export async function checkSignupLimit(env: Cloudflare.Env, ip: string, now: number): Promise<void> {
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM signup_log WHERE ip = ? AND at > ?').bind(ip, now - 3_600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= SIGNUP_LIMIT_PER_HOUR) throw new HttpError(429, '잠시 뒤 다시 시도해 주세요');
}

/** 새 계정 행 + 가입 기록 (batch에 넣는다) */
export function newUserStatements(env: Cloudflare.Env, userId: string, nickname: string, tokenHash: string, ip: string, now: number): D1PreparedStatement[] {
  const iso = new Date(now).toISOString();
  return [
    env.DB.prepare('INSERT INTO users (id, nickname, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(userId, nickname, tokenHash, iso, iso),
    env.DB.prepare('INSERT INTO signup_log (ip, at) VALUES (?, ?)').bind(ip, now),
    env.DB.prepare('DELETE FROM signup_log WHERE at < ?').bind(now - 86_400_000),
  ];
}

export async function signup(env: Cloudflare.Env, nickname: string, ip: string, now = Date.now()): Promise<{ userId: string; token: string }> {
  await checkSignupLimit(env, ip, now);
  const userId = crypto.randomUUID();
  const token = newToken();
  await env.DB.batch(newUserStatements(env, userId, nickname, await sha256Hex(token), ip, now));
  return { userId, token };
}

/** 요청 머리글의 폰 열쇠 (없으면 빈 글) */
export function bearer(req: Request): string {
  const auth = req.headers.get('Authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

/** 폰 열쇠로 사용자 ID를 찾는다: 첫 익명 열쇠(users) 또는 로그인으로 받은 기기 열쇠(user_tokens). 없으면 null */
export async function userOfToken(env: Cloudflare.Env, token: string): Promise<string | null> {
  if (token.length < 20 || token.length > 200) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT id FROM users WHERE token_hash = ? UNION ALL SELECT user_id AS id FROM user_tokens WHERE token_hash = ? LIMIT 1')
    .bind(hash, hash)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** 요청의 폰 열쇠로 사용자 ID를 찾는다. 없거나 틀리면 401. tokenOverride: 실시간 연결처럼 머리글 대신 받은 열쇠 */
export async function authenticate(req: Request, env: Cloudflare.Env, tokenOverride?: string | null): Promise<string> {
  const id = await userOfToken(env, tokenOverride ?? bearer(req));
  if (!id) throw new HttpError(401, '로그인 필요');
  return id;
}

export const newToken = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));

/** 이 계정의 새 기기 열쇠를 만든다 (로그인). 서버에는 SHA-256 값만 */
export async function issueToken(env: Cloudflare.Env, userId: string): Promise<string> {
  const token = newToken();
  await env.DB.prepare('INSERT INTO user_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), userId, new Date().toISOString()).run();
  return token;
}

/** 이 열쇠를 못 쓰게 하는 문장 (batch에 넣는다). 첫 익명 열쇠면 아무도 모르는 값으로 바꾼다 */
export async function revokeTokenStatements(env: Cloudflare.Env, token: string): Promise<D1PreparedStatement[]> {
  const hash = await sha256Hex(token);
  return [
    env.DB.prepare('DELETE FROM user_tokens WHERE token_hash = ?').bind(hash),
    env.DB.prepare('UPDATE users SET token_hash = ?, updated_at = ? WHERE token_hash = ?').bind(await sha256Hex(newToken()), new Date().toISOString(), hash),
  ];
}

/** 로그아웃: 이 열쇠만 못 쓰게 한다 */
export async function logout(env: Cloudflare.Env, req: Request): Promise<{ ok: true }> {
  const token = bearer(req);
  const userId = await userOfToken(env, token);
  if (!userId) throw new HttpError(401, '로그인 필요');
  await env.DB.batch(await revokeTokenStatements(env, token));
  return { ok: true };
}
