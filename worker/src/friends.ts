// 친구 위치 공유 (사양서 6.5, M8): 친구 코드로 바로 서로 친구, 위치는 본인이 공유를 켠 동안만.
// 서버에는 사람마다 마지막 위치 하나만 두고, 친구에게는 2분 안에 받은 위치만 준다.
import { HttpError, UUID_RE } from './http';

/** 헷갈리는 0·O·1·I·L을 뺀 31글자 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 8;
/** 틀린 친구 코드는 1시간에 이만큼까지 */
export const CODE_MISSES_PER_HOUR = 20;
export const MAX_FRIENDS = 50;
/** 이보다 오래된 위치는 친구에게 보이지 않는다 */
export const PRESENCE_FRESH_MS = 120_000;

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  // 248 = 31 × 8: 나머지 치우침이 없게 248 이상은 다시 뽑는다
  let out = '';
  for (let i = 0; out.length < CODE_LENGTH; i++) {
    const b = i < bytes.length ? bytes[i]! : crypto.getRandomValues(new Uint8Array(1))[0]!;
    if (b < 248) out += CODE_ALPHABET[b % 31];
  }
  return out;
}

/** 사용자가 넣은 코드 → 비교할 모양 (대문자, 하이픈·공백 제거). 모양이 틀리면 null */
export function normalizeCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.toUpperCase().replace(/[\s-]/g, '');
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null;
}

export async function myCode(env: Cloudflare.Env, userId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT friend_code FROM users WHERE id = ?').bind(userId).first<{ friend_code: string | null }>();
  if (row?.friend_code) return row.friend_code;
  for (let tries = 0; tries < 5; tries++) {
    const code = newCode();
    try {
      const r = await env.DB.prepare('UPDATE users SET friend_code = ? WHERE id = ? AND friend_code IS NULL').bind(code, userId).run();
      if (r.meta.changes === 1) return code;
      // 동시에 다른 요청이 먼저 만들었다
      const again = await env.DB.prepare('SELECT friend_code FROM users WHERE id = ?').bind(userId).first<{ friend_code: string | null }>();
      if (again?.friend_code) return again.friend_code;
    } catch {
      // 드물게 같은 코드가 이미 있음 (UNIQUE): 다시 뽑는다
    }
  }
  throw new HttpError(500, '친구 코드를 만들지 못했습니다');
}

interface FriendRow {
  id: string;
  nickname: string;
  created_at: string;
  at: number | null;
}

export async function listFriends(env: Cloudflare.Env, userId: string, now = Date.now()) {
  const code = await myCode(env, userId);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.nickname, f.created_at, p.at FROM friends f
       JOIN users u ON u.id = f.friend_id
       LEFT JOIN presence p ON p.user_id = f.friend_id
     WHERE f.user_id = ? ORDER BY u.nickname`,
  )
    .bind(userId)
    .all<FriendRow>();
  return {
    code,
    friends: results.map((r) => ({ userId: r.id, nickname: r.nickname, since: r.created_at, sharing: r.at !== null && now - r.at < PRESENCE_FRESH_MS })),
  };
}

export async function addFriend(env: Cloudflare.Env, userId: string, body: unknown, now = Date.now()) {
  const code = normalizeCode((body as { code?: unknown } | null)?.code);
  if (!code) throw new HttpError(400, '친구 코드는 8자리예요');
  const hourAgo = now - 3_600_000;
  const misses = await env.DB.prepare('SELECT COUNT(*) AS n FROM friend_code_misses WHERE user_id = ? AND at > ?').bind(userId, hourAgo).first<{ n: number }>();
  if ((misses?.n ?? 0) >= CODE_MISSES_PER_HOUR) throw new HttpError(429, '잠시 뒤 다시 시도해 주세요');
  const friend = await env.DB.prepare('SELECT id, nickname FROM users WHERE friend_code = ?').bind(code).first<{ id: string; nickname: string }>();
  if (!friend) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO friend_code_misses (user_id, at) VALUES (?, ?)').bind(userId, now),
      env.DB.prepare('DELETE FROM friend_code_misses WHERE at < ?').bind(now - 86_400_000),
    ]);
    throw new HttpError(404, '친구 코드를 찾을 수 없어요');
  }
  if (friend.id === userId) throw new HttpError(400, '내 친구 코드예요');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?').bind(userId).first<{ n: number }>();
  const already = await env.DB.prepare('SELECT 1 AS x FROM friends WHERE user_id = ? AND friend_id = ?').bind(userId, friend.id).first();
  if (!already && (count?.n ?? 0) >= MAX_FRIENDS) throw new HttpError(400, `친구는 ${MAX_FRIENDS}명까지예요`);
  const iso = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').bind(userId, friend.id, iso),
    env.DB.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').bind(friend.id, userId, iso),
  ]);
  return { userId: friend.id, nickname: friend.nickname, already: !!already };
}

export async function removeFriend(env: Cloudflare.Env, userId: string, friendId: string) {
  if (!UUID_RE.test(friendId)) throw new HttpError(400, '잘못된 친구 id');
  const id = friendId.toLowerCase();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').bind(userId, id),
    env.DB.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').bind(id, userId),
  ]);
  return { ok: true };
}

const numIn = (v: unknown, min: number, max: number, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `잘못된 값: ${what}`);
  return v;
};
const optIn = (v: unknown, min: number, max: number, what: string): number | null => (v === null || v === undefined ? null : numIn(v, min, max, what));

export async function putPresence(env: Cloudflare.Env, userId: string, body: unknown, now = Date.now()) {
  const b = (body ?? {}) as Record<string, unknown>;
  const lat = numIn(b.lat, -90, 90, 'lat');
  const lon = numIn(b.lon, -180, 180, 'lon');
  const hAcc = optIn(b.hAcc, 0, 100_000, 'hAcc');
  const heading = optIn(b.heading, 0, 360, 'heading');
  const speed = optIn(b.speed, 0, 200, 'speed');
  await env.DB.prepare(
    `INSERT INTO presence (user_id, lat, lon, h_acc, heading, speed, at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, h_acc = excluded.h_acc,
       heading = excluded.heading, speed = excluded.speed, at = excluded.at`,
  )
    .bind(userId, lat, lon, hAcc, heading, speed, now)
    .run();
  return { ok: true, at: now };
}

export async function deletePresence(env: Cloudflare.Env, userId: string) {
  await env.DB.prepare('DELETE FROM presence WHERE user_id = ?').bind(userId).run();
  return { ok: true };
}

interface PresenceRow {
  id: string;
  nickname: string;
  lat: number;
  lon: number;
  h_acc: number | null;
  heading: number | null;
  speed: number | null;
  at: number;
}

/** 공유 중인 친구의 위치 (2분 안에 받은 것만) */
export async function friendPresence(env: Cloudflare.Env, userId: string, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.nickname, p.lat, p.lon, p.h_acc, p.heading, p.speed, p.at FROM friends f
       JOIN presence p ON p.user_id = f.friend_id
       JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ? AND p.at > ?`,
  )
    .bind(userId, now - PRESENCE_FRESH_MS)
    .all<PresenceRow>();
  return results.map((r) => ({ userId: r.id, nickname: r.nickname, lat: r.lat, lon: r.lon, hAcc: r.h_acc, heading: r.heading, speed: r.speed, ageMs: Math.max(0, now - r.at) }));
}
