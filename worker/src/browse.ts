// 코스 둘러보기 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md, 사용자 요청 "즐겨찾기", "인기 도로 최근30일·7일·전체·계절·실시간"):
//   GET/PUT /api/prefs        즐겨찾기·분류 (계정마다 JSON 하나, 16 KB 이하)
//   GET /api/popular?period=  기본 코스별 달린 사람 수 (많은 순 20개). 기간: live 7d 30d all spring summer autumn winter
//   POST /api/driving {builtin} 기본 코스로 주행 중 신호 (위치 없음). 실시간 = 최근 10분 안에 신호 온 계정 수
//   POST /api/drove {course}    코스를 달렸다는 신호 (기록은 폰에만 2026-11-18: 기록 대신 이것으로 센다. 코스 열쇠·한국 날짜만)
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
  // 예전 앱이 올린 기록(sessions) + 새 신호(course_drives)를 합쳐 계정 수를 센다 (같은 사람은 한 번)
  let whereS = '';
  let whereD = '';
  const bindsS: Array<string | number> = [];
  const bindsD: Array<string | number> = [];
  if (period === '7d' || period === '30d') {
    const from = now - (period === '7d' ? 7 : 30) * DAY;
    whereS = 'AND s.started_at >= ?';
    bindsS.push(new Date(from).toISOString());
    whereD = 'AND d.day >= ?';
    bindsD.push(kstDay(from));
  } else if (period && Object.hasOwn(SEASON, period)) {
    // 한국 시각 달
    const months = SEASON[period]!.join(',');
    whereS = `AND CAST(strftime('%m', s.started_at, '+9 hours') AS INTEGER) IN (${months})`;
    whereD = `AND CAST(substr(d.day, 6, 2) AS INTEGER) IN (${months})`;
  } else if (period !== 'all') throw new HttpError(400, '모르는 기간');
  const r = await env.DB.prepare(
    `SELECT builtin, COUNT(DISTINCT uid) AS drivers FROM (
       SELECT c.builtin AS builtin, s.owner_id AS uid FROM sessions s JOIN courses c ON c.id = s.course_id WHERE c.builtin IS NOT NULL ${whereS}
       UNION
       SELECT substr(d.course_key, 3) AS builtin, d.user_id AS uid FROM course_drives d WHERE d.course_key LIKE 'b:%' ${whereD}
     ) GROUP BY builtin ORDER BY drivers DESC, builtin LIMIT 20`,
  )
    .bind(...bindsS, ...bindsD)
    .all<{ builtin: string; drivers: number }>();
  return r.results.map((x) => ({ builtin: x.builtin, drivers: Number(x.drivers) }));
}

/** 한국 날짜 YYYY-MM-DD */
const kstDay = (t: number): string => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);

/** 코스를 달렸다는 신호: 계정·코스·한국 날짜마다 한 줄 (같은 날 여러 번은 한 번) */
export async function drove(env: Cloudflare.Env, userId: string, body: unknown, now = Date.now()): Promise<{ ok: true }> {
  const course = (body as { course?: unknown } | null)?.course;
  if (typeof course !== 'string' || !/^[bs]:.+/.test(course) || course.length > MAX_KEY_LEN) throw new HttpError(400, '잘못된 코스 열쇠');
  await env.DB.prepare('INSERT OR IGNORE INTO course_drives (user_id, course_key, day) VALUES (?, ?, ?)').bind(userId, course, kstDay(now)).run();
  return { ok: true };
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
