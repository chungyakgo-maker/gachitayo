// 기록 표 API (사양서 6.5): 코스·세션·랩·닉네임. 같은 id면 덮어쓰고(upsert), 다른 사람 행은 403.
import { HttpError, UUID_RE } from './http';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new HttpError(400, `잘못된 값: ${what}`);
};
const num = (v: unknown, what: string) => (typeof v === 'number' && Number.isFinite(v) ? v : bad(what));
const numOrNull = (v: unknown, what: string) => (v === null || v === undefined ? null : num(v, what));
const int = (v: unknown, what: string, min = 0) => (Number.isInteger(v) && (v as number) >= min ? (v as number) : bad(what));
const intOrNull = (v: unknown, what: string) => (v === null || v === undefined ? null : int(v, what));
const str = (v: unknown, what: string, max = 200) => (typeof v === 'string' && v.length <= max ? v : bad(what));
const strOrNull = (v: unknown, what: string, max = 200) => (v === null || v === undefined ? null : str(v, what, max));
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string): T => (list.includes(v as T) ? (v as T) : bad(what));
const isoTime = (v: unknown, what: string) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : bad(what));
const jsonText = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

function gate(v: unknown, what: string) {
  if (!isObj(v)) bad(what);
  const g = v as Record<string, unknown>;
  return { lat: num(g.lat, what), lon: num(g.lon, what), bearingDeg: num(g.bearingDeg, what), widthM: num(g.widthM, what) };
}

function pair(v: unknown, what: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) bad(what);
  return [num((v as unknown[])[0], what), num((v as unknown[])[1], what)];
}

// ── 닉네임 ────────────────────────────────────────────

export async function getMe(env: Cloudflare.Env, userId: string) {
  const row = await env.DB.prepare('SELECT id, nickname FROM users WHERE id = ?').bind(userId).first<{ id: string; nickname: string }>();
  return { userId: row!.id, nickname: row!.nickname };
}

export async function putMe(env: Cloudflare.Env, userId: string, nickname: string) {
  await env.DB.prepare('UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?').bind(nickname, new Date().toISOString(), userId).run();
  return { userId, nickname };
}

// ── 코스 ──────────────────────────────────────────────

export async function putCourse(env: Cloudflare.Env, userId: string, id: string, body: unknown) {
  if (!isObj(body)) bad('본문');
  const b = body as Record<string, unknown>;
  const origin = isObj(b.origin) ? { lat: num(b.origin.lat, 'origin'), lon: num(b.origin.lon, 'origin') } : bad('origin');
  const centerline = b.centerline === null || b.centerline === undefined ? null : Array.isArray(b.centerline) ? b.centerline.map((p) => pair(p, 'centerline')) : bad('centerline');
  const now = new Date().toISOString();
  const r = await env.DB.prepare(
    `INSERT INTO courses (id, owner_id, name, kind, source, origin, start_gate, finish_gate, centerline, length_m, sector_bounds_m, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, source = excluded.source, origin = excluded.origin,
       start_gate = excluded.start_gate, finish_gate = excluded.finish_gate, centerline = excluded.centerline, length_m = excluded.length_m,
       sector_bounds_m = excluded.sector_bounds_m, version = excluded.version, updated_at = excluded.updated_at
     WHERE courses.owner_id = excluded.owner_id`,
  )
    .bind(
      id,
      userId,
      str(b.name, 'name', 60),
      oneOf(b.kind, ['loop', 'point_to_point'] as const, 'kind'),
      oneOf(b.source, ['auto', 'map', 'gpx'] as const, 'source'),
      JSON.stringify(origin),
      JSON.stringify(gate(b.start_gate, 'start_gate')),
      JSON.stringify(gate(b.finish_gate, 'finish_gate')),
      jsonText(centerline),
      numOrNull(b.length_m, 'length_m'),
      jsonText(b.sector_bounds_m === null || b.sector_bounds_m === undefined ? null : pair(b.sector_bounds_m, 'sector_bounds_m')),
      int(b.version, 'version', 1),
      now,
      now,
    )
    .run();
  if (r.meta.changes === 0) throw new HttpError(403, '다른 사람의 코스');
  return { id };
}

interface CourseRowDb {
  id: string;
  name: string;
  kind: string;
  source: string;
  origin: string;
  start_gate: string;
  finish_gate: string;
  centerline: string | null;
  length_m: number | null;
  sector_bounds_m: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export async function listCourses(env: Cloudflare.Env, userId: string) {
  const { results } = await env.DB.prepare('SELECT * FROM courses WHERE owner_id = ? ORDER BY updated_at DESC').bind(userId).all<CourseRowDb>();
  const parse = (s: string | null) => (s === null ? null : (JSON.parse(s) as unknown));
  return results.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    source: c.source,
    origin: parse(c.origin),
    start_gate: parse(c.start_gate),
    finish_gate: parse(c.finish_gate),
    centerline: parse(c.centerline),
    length_m: c.length_m,
    sector_bounds_m: parse(c.sector_bounds_m),
    version: c.version,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));
}

// ── 세션 ──────────────────────────────────────────────

async function ownerOf(env: Cloudflare.Env, table: 'courses' | 'sessions', id: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT owner_id FROM ${table} WHERE id = ?`).bind(id).first<{ owner_id: string }>();
  return row?.owner_id ?? null;
}

export async function putSession(env: Cloudflare.Env, userId: string, id: string, body: unknown) {
  if (!isObj(body)) bad('본문');
  const b = body as Record<string, unknown>;
  const courseId = b.course_id === null || b.course_id === undefined ? null : typeof b.course_id === 'string' && UUID_RE.test(b.course_id) ? b.course_id.toLowerCase() : bad('course_id');
  if (courseId) {
    const owner = await ownerOf(env, 'courses', courseId);
    if (owner === null) throw new HttpError(400, '코스를 먼저 올려 주세요');
    if (owner !== userId) throw new HttpError(403, '다른 사람의 코스');
  }
  // 파일 키는 본인 폴더의 이 세션 파일만
  const key = (v: unknown, kind: string) => {
    const k = strOrNull(v, kind);
    if (k !== null && k !== `${userId}/${id}.${kind}.json.gz`) bad(kind);
    return k;
  };
  const r = await env.DB.prepare(
    `INSERT INTO sessions (id, owner_id, course_id, course_version, started_at, ended_at, device, calibration, raw_key, processed_key, format_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET course_id = excluded.course_id, course_version = excluded.course_version, started_at = excluded.started_at,
       ended_at = excluded.ended_at, device = excluded.device, calibration = excluded.calibration, raw_key = excluded.raw_key,
       processed_key = excluded.processed_key, format_version = excluded.format_version
     WHERE sessions.owner_id = excluded.owner_id`,
  )
    .bind(
      id,
      userId,
      courseId,
      intOrNull(b.course_version, 'course_version'),
      isoTime(b.started_at, 'started_at'),
      b.ended_at === null || b.ended_at === undefined ? null : isoTime(b.ended_at, 'ended_at'),
      jsonText(isObj(b.device) || b.device === null || b.device === undefined ? b.device : bad('device')),
      jsonText(isObj(b.calibration) || b.calibration === null || b.calibration === undefined ? b.calibration : bad('calibration')),
      key(b.raw_key, 'raw'),
      key(b.processed_key, 'processed'),
      int(b.format_version, 'format_version', 1),
      new Date().toISOString(),
    )
    .run();
  if (r.meta.changes === 0) throw new HttpError(403, '다른 사람의 세션');
  return { id };
}

/** 기록 지우기 (M10, 사용자 요청): 랩·세션 행과 R2의 원본·처리된 파일. 서버에 없는 세션이어도 성공(같은 요청을 다시 보내도 됨) */
export async function deleteSession(env: Cloudflare.Env, userId: string, id: string) {
  const owner = await ownerOf(env, 'sessions', id);
  if (owner !== null && owner !== userId) throw new HttpError(403, '다른 사람의 세션');
  if (owner !== null) {
    await env.DB.batch([env.DB.prepare('DELETE FROM laps WHERE session_id = ?').bind(id), env.DB.prepare('DELETE FROM sessions WHERE id = ? AND owner_id = ?').bind(id, userId)]);
  }
  // 파일은 본인 폴더의 이 세션 것만 (행 없이 파일만 올라간 경우도 지운다)
  await env.SESSION_FILES.delete([`${userId}/${id}.raw.json.gz`, `${userId}/${id}.processed.json.gz`]);
  return { ok: true, existed: owner !== null };
}

// ── 랩 ───────────────────────────────────────────────

const MAX_LAPS = 500;

/** 세션의 랩을 통째로 바꾼다 (다시 처리해서 랩이 줄어도 옛 랩이 남지 않게). 한 번에(트랜잭션) 처리한다 */
export async function putLaps(env: Cloudflare.Env, userId: string, sessionId: string, body: unknown) {
  if (!Array.isArray(body) || body.length > MAX_LAPS) bad('랩 목록');
  const owner = await ownerOf(env, 'sessions', sessionId);
  if (owner === null) throw new HttpError(404, '세션을 먼저 올려 주세요');
  if (owner !== userId) throw new HttpError(403, '다른 사람의 세션');
  const now = new Date().toISOString();
  const seen = new Set<number>();
  const inserts = (body as unknown[]).map((v) => {
    if (!isObj(v)) bad('랩');
    const l = v as Record<string, unknown>;
    const lapNo = int(l.lap_no, 'lap_no', 1);
    if (seen.has(lapNo)) bad('lap_no 중복');
    seen.add(lapNo);
    const sectors = l.sector_times_ms === null || l.sector_times_ms === undefined ? null : Array.isArray(l.sector_times_ms) && l.sector_times_ms.length === 3 ? l.sector_times_ms.map((s) => intOrNull(s, 'sector_times_ms')) : bad('sector_times_ms');
    if (typeof l.valid !== 'boolean') bad('valid');
    return env.DB.prepare(
      `INSERT INTO laps (session_id, lap_no, owner_id, lap_time_ms, sector_times_ms, valid, invalid_reason, max_speed, trace, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      sessionId,
      lapNo,
      userId,
      int(l.lap_time_ms, 'lap_time_ms'),
      jsonText(sectors),
      l.valid ? 1 : 0,
      strOrNull(l.invalid_reason, 'invalid_reason', 40),
      numOrNull(l.max_speed, 'max_speed'),
      jsonText(isObj(l.trace) || l.trace === null || l.trace === undefined ? l.trace : bad('trace')),
      now,
    );
  });
  await env.DB.batch([env.DB.prepare('DELETE FROM laps WHERE session_id = ? AND owner_id = ?').bind(sessionId, userId), ...inserts]);
  return { sessionId, laps: inserts.length };
}
