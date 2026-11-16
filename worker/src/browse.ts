// 코스 둘러보기 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md, 사용자 요청 "즐겨찾기", "인기 도로 최근30일·7일·전체·계절·실시간"):
//   GET/PUT /api/prefs        즐겨찾기·분류 (계정마다 JSON 하나, 16 KB 이하)
//   GET /api/popular?period=  기본 코스별 달린 사람 수 (많은 순 20개). 기간: live 7d 30d all spring summer autumn winter
//   POST /api/driving {builtin} 기본 코스로 주행 중 신호 (위치 없음). 실시간 = 최근 10분 안에 신호 온 계정 수
import { HttpError } from './http';

export interface Prefs {
  favorites: string[];
  tags: Record<string, Array<'coast' | 'mountain'>>;
}

const TAGS = new Set(['coast', 'mountain']);
const MAX_KEYS = 500;
const MAX_KEY_LEN = 80;
const LIVE_MS = 10 * 60_000;
const DAY = 86_400_000;
const SEASON: Record<string, number[]> = { spring: [3, 4, 5], summer: [6, 7, 8], autumn: [9, 10, 11], winter: [12, 1, 2] };

const key = (v: unknown): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_KEY_LEN) throw new HttpError(400, '잘못된 코스 열쇠');
  return v;
};

export function validPrefs(body: unknown): Prefs {
  const b = body as { favorites?: unknown; tags?: unknown } | null;
  if (!b || !Array.isArray(b.favorites) || typeof b.tags !== 'object' || b.tags === null || Array.isArray(b.tags)) throw new HttpError(400, '잘못된 설정');
  if (b.favorites.length > MAX_KEYS) throw new HttpError(400, '즐겨찾기가 너무 많아요');
  const favorites = [...new Set(b.favorites.map(key))];
  const entries = Object.entries(b.tags as Record<string, unknown>);
  if (entries.length > MAX_KEYS) throw new HttpError(400, '분류가 너무 많아요');
  const tags: Prefs['tags'] = {};
  for (const [k, v] of entries) {
    if (!Array.isArray(v) || !v.every((t) => typeof t === 'string' && TAGS.has(t))) throw new HttpError(400, '모르는 분류');
    tags[key(k)] = [...new Set(v as Array<'coast' | 'mountain'>)];
  }
  return { favorites, tags };
}

export async function getPrefs(env: Cloudflare.Env, userId: string): Promise<Prefs> {
  const row = await env.DB.prepare('SELECT data FROM user_prefs WHERE user_id = ?').bind(userId).first<{ data: string }>();
  if (!row) return { favorites: [], tags: {} };
  try {
    return validPrefs(JSON.parse(row.data));
  } catch {
    return { favorites: [], tags: {} };
  }
}

export async function putPrefs(env: Cloudflare.Env, userId: string, body: unknown, now = Date.now()): Promise<Prefs> {
  const p = validPrefs(body);
  await env.DB.prepare('INSERT INTO user_prefs (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(userId, JSON.stringify(p), now)
    .run();
  return p;
}

export async function popular(env: Cloudflare.Env, period: string | null, now = Date.now()): Promise<Array<{ builtin: string; drivers: number }>> {
  if (period === 'live') {
    const r = await env.DB.prepare('SELECT builtin, COUNT(*) AS drivers FROM driving_now WHERE at > ? GROUP BY builtin ORDER BY drivers DESC, builtin LIMIT 20')
      .bind(now - LIVE_MS)
      .all<{ builtin: string; drivers: number }>();
    return r.results.map((x) => ({ builtin: x.builtin, drivers: Number(x.drivers) }));
  }
  let where = '';
  const binds: Array<string | number> = [];
  if (period === '7d' || period === '30d') {
    where = 'AND s.started_at >= ?';
    binds.push(new Date(now - (period === '7d' ? 7 : 30) * DAY).toISOString());
  } else if (period && Object.hasOwn(SEASON, period)) {
    // 한국 시각 달
    where = `AND CAST(strftime('%m', s.started_at, '+9 hours') AS INTEGER) IN (${SEASON[period]!.join(',')})`;
  } else if (period !== 'all') throw new HttpError(400, '모르는 기간');
  const r = await env.DB.prepare(
    `SELECT c.builtin AS builtin, COUNT(DISTINCT s.owner_id) AS drivers FROM sessions s JOIN courses c ON c.id = s.course_id
     WHERE c.builtin IS NOT NULL ${where} GROUP BY c.builtin ORDER BY drivers DESC, c.builtin LIMIT 20`,
  )
    .bind(...binds)
    .all<{ builtin: string; drivers: number }>();
  return r.results.map((x) => ({ builtin: x.builtin, drivers: Number(x.drivers) }));
}

export async function drivingNow(env: Cloudflare.Env, userId: string, body: unknown, now = Date.now()): Promise<{ ok: true }> {
  const builtin = key((body as { builtin?: unknown } | null)?.builtin);
  // 10분 지난 신호는 지운다 (실시간에 세지 않으므로 남겨 둘 까닭이 없다, 검토 지적)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM driving_now WHERE at < ?').bind(now - LIVE_MS),
    env.DB.prepare('INSERT INTO driving_now (user_id, builtin, at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET builtin = excluded.builtin, at = excluded.at').bind(userId, builtin, now),
  ]);
  return { ok: true };
}
