// 모두의 코스 (설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md 2부, 시안 ⑥⑦⑧):
//   POST   /api/shared               공개 (카카오·애플 로그인 계정만, 계정당 20개)
//   GET    /api/shared?after=        공개 중인 코스 요약 (새것부터 300개씩, 차단·공개 막힌 사람 빼고)
//   GET    /api/shared/{id}          상세 (줄인 선 포함. 숨긴 것은 올린 사람·관리자만)
//   PUT    /api/shared/{id}          고치기 (올린 사람)
//   DELETE /api/shared/{id}          내리기 (올린 사람·관리자, 받기·신고 줄도)
//   POST   /api/shared/{id}/add      받기 (한 사람 한 번 센다)
// 기록·랩 시간은 받지 않는다. 위치는 공개한 코스 선뿐(가까운 순 정렬은 앱이 한다, 내 위치를 받지 않는다)
import { hasBadWord } from './badWords';
import { HttpError } from './http';

export const PUBLISH_LIMIT = 20;
export const PAGE = 300;
const MIN_LEN_M = 300;
const MAX_LEN_M = 100_000;
const MAX_POINTS = 5000;
const MAX_THUMB = 40;
export const SIDOS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'] as const;

type LatLon = [number, number];
interface Gate {
  lat: number;
  lon: number;
  bearingDeg: number;
  widthM: number;
}
export interface SharedBody {
  name: string;
  region: string;
  kind: 'loop' | 'point_to_point';
  lengthM: number;
  startGate: Gate;
  finishGate: Gate;
  sectorBoundsM: [number, number] | null;
  line: LatLon[];
  thumb: LatLon[];
}

const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const pts = (v: unknown, min: number, max: number): v is LatLon[] =>
  Array.isArray(v) && v.length >= min && v.length <= max && v.every((p) => Array.isArray(p) && p.length === 2 && num(p[0], -90, 90) && num(p[1], -180, 180));
const gate = (v: unknown): v is Gate => {
  const g = v as Gate | null;
  return !!g && num(g.lat, -90, 90) && num(g.lon, -180, 180) && num(g.bearingDeg, -360, 360) && num(g.widthM, 1, 200);
};

export function validBody(body: unknown): SharedBody {
  const b = body as Partial<SharedBody> | null;
  if (!b || typeof b.name !== 'string') throw new HttpError(400, '잘못된 코스');
  const name = b.name.trim();
  if (name.length < 1 || name.length > 40) throw new HttpError(400, '이름은 1~40자로 적어 주세요');
  if (hasBadWord(name)) throw new HttpError(400, '이름에 쓸 수 없는 말이 있어요');
  if (typeof b.region !== 'string' || (b.region !== '' && !(SIDOS as readonly string[]).includes(b.region))) throw new HttpError(400, '잘못된 지역');
  if (b.kind !== 'loop' && b.kind !== 'point_to_point') throw new HttpError(400, '잘못된 코스 종류');
  if (!num(b.lengthM, MIN_LEN_M, MAX_LEN_M)) throw new HttpError(400, '코스 길이는 300 m ~ 100 km 여야 해요');
  if (!gate(b.startGate) || !gate(b.finishGate)) throw new HttpError(400, '잘못된 출발선·도착선');
  const sb = b.sectorBoundsM;
  if (sb !== null && sb !== undefined && !(Array.isArray(sb) && sb.length === 2 && sb.every((x) => num(x, 0, MAX_LEN_M)))) throw new HttpError(400, '잘못된 구간');
  if (!pts(b.line, 2, MAX_POINTS) || !pts(b.thumb, 2, MAX_THUMB)) throw new HttpError(400, '잘못된 코스 선');
  return { name, region: b.region, kind: b.kind, lengthM: b.lengthM, startGate: b.startGate, finishGate: b.finishGate, sectorBoundsM: sb ?? null, line: b.line, thumb: b.thumb };
}

/** 관리자인지 (Worker 비밀값 ADMIN_USER_IDS, 쉼표로 여러 계정) */
export function isAdmin(env: Cloudflare.Env, userId: string): boolean {
  return (env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

/** 카카오·애플 로그인을 연결한 계정인지 (공개·신고는 이 계정만 — 익명 계정을 여러 개 만들어 신고 숨김을 악용하지 못하게) */
export async function isSignedIn(env: Cloudflare.Env, userId: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 FROM identities WHERE user_id = ? LIMIT 1').bind(userId).first());
}

interface Row {
  id: string;
  owner_id: string;
  name: string;
  region: string;
  kind: string;
  length_m: number;
  start_gate: string;
  finish_gate: string;
  sector_bounds: string | null;
  line?: string;
  thumb: string;
  start_lat: number;
  start_lon: number;
  adds: number;
  reports: number;
  status: string;
  created_at: number;
  nickname: string;
}

const summary = (r: Row, me: string) => ({
  id: r.id,
  name: r.name,
  region: r.region,
  kind: r.kind,
  lengthM: r.length_m,
  start: { lat: r.start_lat, lon: r.start_lon },
  thumb: JSON.parse(r.thumb) as LatLon[],
  adds: Number(r.adds),
  by: r.nickname,
  byId: r.owner_id,
  createdAt: Number(r.created_at),
  mine: r.owner_id === me,
});
export type SharedSummary = ReturnType<typeof summary>;

const SELECT = `SELECT p.id, p.owner_id, p.name, p.region, p.kind, p.length_m, p.start_gate, p.finish_gate, p.sector_bounds, p.thumb, p.start_lat, p.start_lon,
  p.adds, p.reports, p.status, p.created_at, u.nickname FROM public_courses p JOIN users u ON u.id = p.owner_id`;

export async function publishShared(env: Cloudflare.Env, userId: string, body: unknown, now = Date.now()): Promise<{ id: string }> {
  if (!(await isSignedIn(env, userId))) throw new HttpError(403, '공개하려면 카카오나 Apple로 로그인해 주세요');
  if (await env.DB.prepare('SELECT 1 FROM publish_bans WHERE user_id = ?').bind(userId).first()) throw new HttpError(403, '이 계정은 코스를 공개할 수 없어요');
  const b = validBody(body);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM public_courses WHERE owner_id = ?').bind(userId).first<{ n: number }>();
  if (Number(n?.n ?? 0) >= PUBLISH_LIMIT) throw new HttpError(400, `공개는 ${PUBLISH_LIMIT}개까지예요`);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO public_courses (id, owner_id, name, region, kind, length_m, start_gate, finish_gate, sector_bounds, line, thumb, start_lat, start_lon, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, b.name, b.region, b.kind, b.lengthM, JSON.stringify(b.startGate), JSON.stringify(b.finishGate), b.sectorBoundsM ? JSON.stringify(b.sectorBoundsM) : null, JSON.stringify(b.line), JSON.stringify(b.thumb), b.startGate.lat, b.startGate.lon, now, now)
    .run();
  return { id };
}

export async function updateShared(env: Cloudflare.Env, userId: string, id: string, body: unknown, now = Date.now()): Promise<{ id: string }> {
  const row = await env.DB.prepare('SELECT owner_id FROM public_courses WHERE id = ?').bind(id).first<{ owner_id: string }>();
  if (!row) throw new HttpError(404, '공개 코스를 찾지 못했어요');
  if (row.owner_id !== userId) throw new HttpError(403, '올린 사람만 고칠 수 있어요');
  const b = validBody(body);
  // 숨김(신고·관리자)은 그대로 둔다 — 고친다고 다시 보이게 하지 않는다
  await env.DB.prepare(
    `UPDATE public_courses SET name = ?, region = ?, kind = ?, length_m = ?, start_gate = ?, finish_gate = ?, sector_bounds = ?, line = ?, thumb = ?, start_lat = ?, start_lon = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(b.name, b.region, b.kind, b.lengthM, JSON.stringify(b.startGate), JSON.stringify(b.finishGate), b.sectorBoundsM ? JSON.stringify(b.sectorBoundsM) : null, JSON.stringify(b.line), JSON.stringify(b.thumb), b.startGate.lat, b.startGate.lon, now, id)
    .run();
  return { id };
}

/** 공개 코스와 그 받기·신고 줄을 지운다 */
export function deleteSharedStatements(env: Cloudflare.Env, id: string): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM course_adds WHERE course_id = ?').bind(id),
    env.DB.prepare('DELETE FROM course_reports WHERE course_id = ?').bind(id),
    env.DB.prepare('DELETE FROM public_courses WHERE id = ?').bind(id),
  ];
}

export async function deleteShared(env: Cloudflare.Env, userId: string, id: string): Promise<{ ok: true }> {
  const row = await env.DB.prepare('SELECT owner_id FROM public_courses WHERE id = ?').bind(id).first<{ owner_id: string }>();
  if (!row) throw new HttpError(404, '공개 코스를 찾지 못했어요');
  if (row.owner_id !== userId && !isAdmin(env, userId)) throw new HttpError(403, '올린 사람만 내릴 수 있어요');
  await env.DB.batch(deleteSharedStatements(env, id));
  return { ok: true };
}

/** 목록: 공개 중인 것, 새것부터. 내가 안 보기로 한 사람·공개 막힌 사람의 것은 뺀다. 커서 "{created_at}:{id}" */
export async function listShared(env: Cloudflare.Env, userId: string, after: string | null): Promise<{ items: SharedSummary[]; next: string | null }> {
  const m = after ? /^(\d+):([0-9a-f-]{36})$/.exec(after) : null;
  if (after && !m) throw new HttpError(400, '잘못된 쪽');
  const where = m ? 'AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))' : '';
  const binds: Array<string | number> = [userId];
  if (m) binds.push(Number(m[1]), Number(m[1]), m[2]!);
  const r = await env.DB.prepare(
    `${SELECT} WHERE p.status = 'open'
       AND p.owner_id NOT IN (SELECT blocked_id FROM user_blocks WHERE user_id = ?)
       AND p.owner_id NOT IN (SELECT user_id FROM publish_bans)
       ${where}
     ORDER BY p.created_at DESC, p.id DESC LIMIT ${PAGE + 1}`,
  )
    .bind(...binds)
    .all<Row>();
  const rows = r.results.slice(0, PAGE);
  const last = rows[rows.length - 1];
  return { items: rows.map((x) => summary(x, userId)), next: r.results.length > PAGE && last ? `${last.created_at}:${last.id}` : null };
}

export async function getShared(env: Cloudflare.Env, userId: string, id: string) {
  const r = await env.DB.prepare(`${SELECT.replace('p.thumb,', 'p.thumb, p.line,')} WHERE p.id = ?`).bind(id).first<Row>();
  const owner = r?.owner_id === userId;
  if (!r || (!owner && !isAdmin(env, userId) && r.status !== 'open')) throw new HttpError(404, '공개 코스를 찾지 못했어요');
  return {
    ...summary(r, userId),
    line: JSON.parse(r.line!) as LatLon[],
    startGate: JSON.parse(r.start_gate) as Gate,
    finishGate: JSON.parse(r.finish_gate) as Gate,
    sectorBoundsM: r.sector_bounds ? (JSON.parse(r.sector_bounds) as [number, number]) : null,
    status: r.status as 'open' | 'hidden',
  };
}

/** 받기: 한 사람 한 번만 센다 */
export async function addShared(env: Cloudflare.Env, userId: string, id: string, now = Date.now()): Promise<{ adds: number }> {
  if (!(await env.DB.prepare('SELECT 1 FROM public_courses WHERE id = ?').bind(id).first())) throw new HttpError(404, '공개 코스를 찾지 못했어요');
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO course_adds (course_id, user_id, at) VALUES (?, ?, ?)').bind(id, userId, now).run();
  if (ins.meta.changes > 0) await env.DB.prepare('UPDATE public_courses SET adds = adds + 1 WHERE id = ?').bind(id).run();
  const r = await env.DB.prepare('SELECT adds FROM public_courses WHERE id = ?').bind(id).first<{ adds: number }>();
  return { adds: Number(r?.adds ?? 0) };
}
