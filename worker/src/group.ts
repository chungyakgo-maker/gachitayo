// 그룹 주행 방 (설계 docs/superpowers/specs/2026-11-16-group-drive-design.md, 사용자 요청 "방만들고 그룹주행"):
// 방마다 Durable Object 하나. 참가자(색·순서·방장), 차 간격, 목적지·경로를 저장하고, 실시간 위치는 웹소켓으로 받아 다른 참가자에게 전한다(저장 안 함).
//   POST /api/rooms            방 만들기 (만든 사람이 방장·1번) → {roomId, code}
//   POST /api/rooms/join {code} 코드로 들어가기 (8명까지) → {roomId}
//   GET  /api/rooms/{id}        방 상태 (참가자만)
//   POST /api/rooms/{id}/order {userIds} · /gap {gapS} · /dest {name, lat, lon, route} (방장만) · /leave
//   GET  /api/rooms/{id}/route  경로 점들 (참가자만)
//   POST /api/rooms/{id}/course {코스 모양} (방장만) · GET /api/rooms/{id}/course (참가자) — 방장이 목적지 대신 코스를 정한다 (3부)
//   웹소켓 /group/{id}          위치 보내기·받기, 방 상태 받기
import { DurableObject } from 'cloudflare:workers';
import { HttpError } from './http';
import { parseLivePoint } from './live';

export const ROOM_MAX = 8;
/** 팀 주행 방은 팀 인원만큼 (사용자 요청 "최대 인원 15명") */
export const TEAM_ROOM_MAX = 15;
export const GAP_MIN_S = 1;
export const GAP_MAX_S = 10;
/** 코드가 유효한 시간. 지나면 방이 닫힌다 (상태·경로·웹소켓 모두, 검토 지적: 방을 안 나가면 위치가 계속 갔다) */
export const ROOM_TTL_MS = 24 * 3_600_000;
const MAX_ROUTE_POINTS = 20_000;
/** 한 계정이 한 시간에 틀릴 수 있는 방 코드 수 (검토 지적: 6자리 코드 맞히기) */
export const ROOM_CODE_MISSES_PER_HOUR = 10;
/** 한 사람 위치를 전하는 가장 짧은 간격 (앱은 1초에 한 번 보낸다) */
const RELAY_MIN_MS = 400;
/** 위치 시각이 서버 시각과 이보다 다르면 버린다 */
const RELAY_CLOCK_MS = 120_000;

export interface Member {
  userId: string;
  nickname: string;
  /** 색 번호 0~7 (8명까지는 겹치지 않음, 그 뒤로는 가장 적게 쓴 색) */
  color: number;
  /** 주행 순서 1부터 */
  order: number;
  host: boolean;
  /** 프로필 사진 id (avatar.ts, 없으면 null) */
  avatar?: string | null;
}
export interface Dest {
  name: string;
  lat: number;
  lon: number;
}
/** 방장이 정한 코스 요약 (방 상태에 실린다, 3부 팀 방 코스 지정) */
export interface RoomCourseMeta {
  name: string;
  kind: 'loop' | 'point_to_point';
  lengthM: number;
  /** 기본 코스 b:{key} · 모두의 코스 s:{공개 번호} · 그 밖엔 null (팀원 폰에서 같은 코스를 찾는 열쇠) */
  key: string | null;
}
interface Gate {
  lat: number;
  lon: number;
  bearingDeg: number;
  widthM: number;
}
/** 코스 모양 (방 저장소 'course', 참가자가 받는다) */
export interface RoomCourse extends RoomCourseMeta {
  startGate: Gate;
  finishGate: Gate;
  sectorBoundsM: [number, number] | null;
  /** 줄인 선 (없으면 빈 배열 — 지도로 만든 코스) */
  line: Array<[number, number]>;
}
export interface RoomRoute {
  points: Array<[number, number]>;
  distanceM: number;
  durationS: number;
  /** 받을 때만: 이 경로의 판 */
  version?: number;
}
interface RoomData {
  code: string;
  /** 만든 시각 (이 시각 + 24시간에 방이 닫힌다) */
  createdAt?: number;
  members: Member[];
  gapS: number;
  dest: Dest | null;
  routeVersion: number;
  /** 방장이 정한 코스 (목적지 대신, 3부). 정하면 dest 는 그 코스 출발점 — 예전 앱은 출발점 목적지로 받는다 */
  course?: RoomCourseMeta | null;
  /** 팀 주행 방이면 팀 (설계 2026-11-18-team-drive). 코드 방은 null */
  teamId?: string | null;
  teamName?: string | null;
  /** 최대 인원 (코드 방 8, 팀 방 15) */
  max?: number;
  /** 팀이 기억한 주행 순서 (사람 id). 들어오는 사람을 이 순서대로 자리 잡는다 */
  pref?: string[];
}
export interface RoomState extends Omit<RoomData, 'createdAt' | 'pref' | 'teamId' | 'teamName' | 'max'> {
  roomId: string;
  teamId: string | null;
  teamName: string | null;
  max: number;
}
/** 팀 방 만들 때 */
export interface TeamRoomInit {
  teamId: string;
  teamName: string;
  gapS: number;
  pref: string[];
}
type Fail = { error: 'forbidden' | 'full' | 'bad' | 'missing' };

const sorted = (m: Member[]) => [...m].sort((a, b) => a.order - b.order);

export class GroupRoom extends DurableObject<Cloudflare.Env> {
  /** 참가자마다 마지막 위치 (새로 붙은 사람에게 바로 주려고, 메모리에만) */
  private last = new Map<string, string>();
  /** 참가자마다 마지막으로 전한 시각 (너무 자주 보내면 버린다) */
  private lastAt = new Map<string, number>();

  private async data(now = Date.now()): Promise<RoomData | null> {
    const d = (await this.ctx.storage.get<RoomData>('room')) ?? null;
    if (!d) return null;
    if (d.createdAt === undefined) {
      // 이 고침 전에 만든 방: 지금부터 24시간
      d.createdAt = now;
      await this.ctx.storage.put('room', d);
      await this.ctx.storage.setAlarm(now + ROOM_TTL_MS);
    }
    if (now - d.createdAt > ROOM_TTL_MS) {
      await this.close();
      return null;
    }
    return d;
  }
  /** 방 닫기: 연결을 끊고 저장한 것을 모두 지운다 */
  private async close(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, '방이 닫혔어요');
      } catch {
        // 이미 닫힘
      }
    }
    this.last.clear();
    this.lastAt.clear();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
  async alarm(): Promise<void> {
    await this.close();
  }
  /** 팀을 지우면 열린 팀 주행 방도 닫는다 (검토 지적: 지운 팀 방에서 위치가 계속 오갔다) */
  async shutdown(): Promise<void> {
    await this.close();
  }
  private async save(d: RoomData): Promise<void> {
    await this.ctx.storage.put('room', d);
    this.broadcast(JSON.stringify({ type: 'state', ...this.view(d) }));
  }
  private view(d: RoomData): RoomState {
    const { createdAt: _c, pref: _p, ...rest } = d;
    return { roomId: this.ctx.id.name ?? '', ...rest, course: d.course ?? null, teamId: d.teamId ?? null, teamName: d.teamName ?? null, max: d.max ?? ROOM_MAX, members: sorted(d.members) };
  }
  private broadcast(msg: string, except?: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(msg);
      } catch {
        // 끊긴 연결은 런타임이 정리한다
      }
    }
  }

  async init(code: string, hostId: string, nickname: string, now = Date.now(), avatar: string | null = null, team?: TeamRoomInit): Promise<RoomState> {
    const d: RoomData = { code, createdAt: now, members: [{ userId: hostId, nickname, color: 0, order: 1, host: true, avatar }], gapS: team?.gapS ?? 2, dest: null, routeVersion: 0 };
    if (team) Object.assign(d, { teamId: team.teamId, teamName: team.teamName, max: TEAM_ROOM_MAX, pref: team.pref });
    await this.save(d);
    await this.ctx.storage.setAlarm(now + ROOM_TTL_MS);
    return this.view(d);
  }

  async join(userId: string, nickname: string, avatar: string | null = null): Promise<RoomState | Fail> {
    const d = await this.data();
    if (!d) return { error: 'missing' };
    if (!d.members.some((m) => m.userId === userId)) {
      if (d.members.length >= (d.max ?? ROOM_MAX)) return { error: 'full' };
      // 가장 적게 쓴 색 (8명까지는 겹치지 않는다. 15명 팀 방은 번호로 구별, 검토 지적: 9번째 사람 색이 비었다)
      const uses = [0, 0, 0, 0, 0, 0, 0, 0];
      for (const m of d.members) uses[m.color] = (uses[m.color] ?? 0) + 1;
      const color = uses.indexOf(Math.min(...uses));
      // 방장이 없으면(혼자 있던 방장이 나갔다 다시 들어옴 등) 들어온 사람이 방장 (검토 지적: 아무도 목적지를 못 정했다)
      d.members.push({ userId, nickname, color, order: d.members.length + 1, host: !d.members.some((m) => m.host), avatar });
      // 팀 방: 팀이 기억한 순서대로 자리 잡는다 (사용자 결정 "순서·간격은 팀마다 기억")
      if (d.pref?.length) {
        const rank = (id: string) => {
          const i = d.pref!.indexOf(id);
          return i < 0 ? Number.MAX_SAFE_INTEGER : i;
        };
        const byJoin = sorted(d.members);
        d.members = byJoin.map((m, i) => ({ m, i })).sort((x, y) => rank(x.m.userId) - rank(y.m.userId) || x.i - y.i).map(({ m }, i) => ({ ...m, order: i + 1 }));
      }
      await this.save(d);
    }
    return this.view(d);
  }

  /** 팀 목록용: 방이 살아 있는지와 사람 수 (참가자 아니어도) */
  async summary(): Promise<{ alive: boolean; count: number }> {
    const d = await this.data();
    return d ? { alive: d.members.length > 0, count: d.members.length } : { alive: false, count: 0 };
  }

  async state(userId: string): Promise<RoomState | Fail> {
    const d = await this.data();
    if (!d) return { error: 'missing' };
    if (!d.members.some((m) => m.userId === userId)) return { error: 'forbidden' };
    return this.view(d);
  }

  private async hostOnly(userId: string): Promise<RoomData | Fail> {
    const d = await this.data();
    if (!d) return { error: 'missing' };
    if (!d.members.some((m) => m.userId === userId && m.host)) return { error: 'forbidden' };
    return d;
  }

  async setOrder(userId: string, userIds: unknown): Promise<RoomState | Fail> {
    const d = await this.hostOnly(userId);
    if ('error' in d) return d;
    if (!Array.isArray(userIds) || userIds.length !== d.members.length || new Set(userIds).size !== userIds.length || !d.members.every((m) => userIds.includes(m.userId))) return { error: 'bad' };
    for (const m of d.members) m.order = userIds.indexOf(m.userId) + 1;
    // 팀 방: 새로 들어오는 사람이 방장이 바꾼 순서를 흐트러뜨리지 않게 이 방의 기억 순서도 바꾼다 (검토 지적)
    if (d.teamId) {
      const now = userIds as string[];
      d.pref = [...now, ...(d.pref ?? []).filter((id) => !now.includes(id))];
    }
    await this.save(d);
    return this.view(d);
  }

  async setGap(userId: string, gapS: unknown): Promise<RoomState | Fail> {
    const d = await this.hostOnly(userId);
    if ('error' in d) return d;
    if (typeof gapS !== 'number' || !Number.isFinite(gapS) || gapS < GAP_MIN_S || gapS > GAP_MAX_S) return { error: 'bad' };
    d.gapS = Math.round(gapS * 2) / 2;
    await this.save(d);
    return this.view(d);
  }

  async setDest(userId: string, dest: Dest, route: RoomRoute): Promise<RoomState | Fail> {
    const d = await this.hostOnly(userId);
    if ('error' in d) return d;
    d.dest = dest;
    d.course = null;
    d.routeVersion += 1;
    await this.ctx.storage.put('route', route);
    await this.ctx.storage.delete('course');
    await this.save(d);
    return this.view(d);
  }

  /** 방장이 코스를 정한다: 목적지는 그 코스 출발점, 경로는 목적지만(거리 0 — 각자 내 위치에서 찾는다). 판 +1 */
  async setCourse(userId: string, course: RoomCourse): Promise<RoomState | Fail> {
    const d = await this.hostOnly(userId);
    if ('error' in d) return d;
    const { lat, lon } = course.startGate;
    d.course = { name: course.name, kind: course.kind, lengthM: course.lengthM, key: course.key };
    d.dest = { name: `${course.name} · 출발점`, lat, lon };
    d.routeVersion += 1;
    await this.ctx.storage.put('course', course);
    await this.ctx.storage.put('route', { points: [[lat, lon], [lat + 0.00001, lon]], distanceM: 0, durationS: 0 } satisfies RoomRoute);
    await this.save(d);
    return this.view(d);
  }

  async courseShape(userId: string): Promise<(RoomCourse & { version: number }) | null | Fail> {
    const d = await this.data();
    if (!d) return { error: 'missing' };
    if (!d.members.some((m) => m.userId === userId)) return { error: 'forbidden' };
    if (!d.course) return null;
    const c = (await this.ctx.storage.get<RoomCourse>('course')) ?? null;
    return c ? { ...c, version: d.routeVersion } : null;
  }

  async route(userId: string): Promise<RoomRoute | null | Fail> {
    const d = await this.data();
    if (!d) return { error: 'missing' };
    if (!d.members.some((m) => m.userId === userId)) return { error: 'forbidden' };
    const r = (await this.ctx.storage.get<RoomRoute>('route')) ?? null;
    // 경로 판을 같이 준다 (검토 지적: 목적지를 연달아 바꾸면 다른 판의 경로를 받을 수 있었다)
    return r ? { ...r, version: d.routeVersion } : null;
  }

  async leave(userId: string): Promise<{ ok: true } | Fail> {
    const d = await this.data();
    if (!d) return { error: 'missing' };
    const me = d.members.find((m) => m.userId === userId);
    if (!me) return { ok: true };
    d.members = sorted(d.members.filter((m) => m.userId !== userId)).map((m, i) => ({ ...m, order: i + 1 }));
    // 방장이 나가면 1번이 방장 (방장 넘기기 화면은 없다)
    if (me.host && d.members[0]) d.members[0].host = true;
    this.last.delete(userId);
    this.lastAt.delete(userId);
    for (const ws of this.ctx.getWebSockets(userId)) ws.close(1000, '나감');
    // 팀 주행 방은 다 나가면 닫는다 (다음에 "팀 주행"을 누르면 새로 연다). 코드 방은 24시간 그대로 (혼자 있던 방장이 다시 들어올 수 있게)
    if (!d.members.length && d.teamId) {
      await this.close();
      return { ok: true };
    }
    await this.save(d);
    return { ok: true };
  }

  async isMember(userId: string): Promise<boolean> {
    const d = await this.data();
    return !!d?.members.some((m) => m.userId === userId);
  }

  async fetch(req: Request): Promise<Response> {
    const userId = req.headers.get('X-User-Id');
    const d = await this.data();
    if (!userId || !d || !d.members.some((m) => m.userId === userId)) return new Response('참가자만', { status: 403 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [userId]);
    server.send(JSON.stringify({ type: 'state', ...this.view(d) }));
    for (const [, msg] of this.last) server.send(msg);
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'gachitayo' } });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    if (typeof msg !== 'string') return;
    const userId = this.ctx.getTags(ws)[0];
    if (!userId) return;
    const p = parseLivePoint(msg);
    if (!p) return;
    // 너무 자주 오거나 시각이 엉뚱하면 버린다 (검토 지적: 한 사람이 쏟아 보내면 모두의 화면이 버벅였다)
    const now = Date.now();
    if (now - (this.lastAt.get(userId) ?? 0) < RELAY_MIN_MS || Math.abs(p.t - now) > RELAY_CLOCK_MS) return;
    this.lastAt.set(userId, now);
    const out = JSON.stringify({ type: 'pos', userId, ...p });
    this.last.set(userId, out);
    this.broadcast(out, ws);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // 이미 닫힘
    }
  }
}

// ── Worker 쪽 (API) ──────────────────────────────────

export const room = (env: Cloudflare.Env, roomId: string) => env.GROUP.get(env.GROUP.idFromName(roomId));

export function unwrap<T>(r: unknown): T {
  if (r && typeof r === 'object' && 'error' in (r as object)) {
    const e = (r as Fail).error;
    if (e === 'forbidden') throw new HttpError(403, '방 참가자만 할 수 있어요');
    if (e === 'full') throw new HttpError(409, '방이 가득 찼어요');
    if (e === 'missing') throw new HttpError(404, '방을 찾지 못했어요');
    throw new HttpError(400, '잘못된 값');
  }
  return r as T;
}

export async function profileOf(env: Cloudflare.Env, userId: string): Promise<{ nickname: string; avatar: string | null }> {
  const r = await env.DB.prepare('SELECT nickname, avatar FROM users WHERE id = ?').bind(userId).first<{ nickname: string; avatar: string | null }>();
  return { nickname: r?.nickname ?? '친구', avatar: r?.avatar ?? null };
}

export async function createRoom(env: Cloudflare.Env, userId: string, now = Date.now()): Promise<{ roomId: string; code: string }> {
  let code = '';
  for (let i = 0; i < 10 && !code; i++) {
    const c = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    const used = await env.DB.prepare('SELECT 1 AS x FROM rooms WHERE code = ? AND created_at > ?').bind(c, now - ROOM_TTL_MS).first();
    if (!used) code = c;
  }
  if (!code) throw new HttpError(503, '잠시 뒤 다시 해 주세요');
  const roomId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO rooms (id, code, host_id, created_at) VALUES (?, ?, ?, ?)').bind(roomId, code, userId, now).run();
  // 코드 방은 친구가 아닐 수 있어 프사를 싣지 않는다 (사진은 친구·같은 팀에게만, 검토 지적)
  const p = await profileOf(env, userId);
  await room(env, roomId).init(code, userId, p.nickname, now, null);
  return { roomId, code };
}

export async function joinRoom(env: Cloudflare.Env, userId: string, body: unknown, now = Date.now()): Promise<{ roomId: string }> {
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new HttpError(400, '방 코드는 숫자 6자리예요');
  const misses = await env.DB.prepare('SELECT COUNT(*) AS n FROM room_code_misses WHERE user_id = ? AND at > ?').bind(userId, now - 3_600_000).first<{ n: number }>();
  if ((misses?.n ?? 0) >= ROOM_CODE_MISSES_PER_HOUR) throw new HttpError(429, '코드를 너무 많이 틀렸어요. 한 시간 뒤 다시 해 주세요');
  const r = await env.DB.prepare('SELECT id FROM rooms WHERE code = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1').bind(code, now - ROOM_TTL_MS).first<{ id: string }>();
  if (!r) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO room_code_misses (user_id, at) VALUES (?, ?)').bind(userId, now),
      env.DB.prepare('DELETE FROM room_code_misses WHERE at < ?').bind(now - 86_400_000),
    ]);
    throw new HttpError(404, '방을 찾지 못했어요');
  }
  const p = await profileOf(env, userId);
  unwrap<RoomState>(await room(env, r.id).join(userId, p.nickname, null));
  return { roomId: r.id };
}

/** 팀 방은 방에 남아 있어도 지금 팀원이어야 한다 (검토 지적: 팀에서 빠진 사람이 남은 방으로 위치를 계속 받았다) */
async function teamGuard(env: Cloudflare.Env, st: RoomState, userId: string): Promise<void> {
  if (!st.teamId) return;
  const ok = await env.DB.prepare('SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?').bind(st.teamId, userId).first();
  if (!ok) throw new HttpError(403, '팀원만 할 수 있어요');
}
async function guarded(env: Cloudflare.Env, roomId: string, userId: string): Promise<RoomState> {
  const st = unwrap<RoomState>(await room(env, roomId).state(userId));
  await teamGuard(env, st, userId);
  return st;
}

export const roomState = (env: Cloudflare.Env, roomId: string, userId: string): Promise<RoomState> => guarded(env, roomId, userId);

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export async function roomAction(env: Cloudflare.Env, roomId: string, userId: string, action: string, body: unknown): Promise<unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  const r = room(env, roomId);
  // 나가기는 언제나 된다. 나머지는 팀 방이면 지금 팀원만
  if (action !== 'leave') await guarded(env, roomId, userId);
  switch (action) {
    case 'order': {
      const st = unwrap<RoomState>(await r.setOrder(userId, b.userIds));
      if (st.teamId) await rememberTeamOrder(env, st);
      return st;
    }
    case 'gap': {
      const st = unwrap<RoomState>(await r.setGap(userId, b.gapS));
      if (st.teamId) await env.DB.prepare('UPDATE teams SET gap_s = ? WHERE id = ?').bind(st.gapS, st.teamId).run();
      return st;
    }
    case 'dest': {
      const route = b.route as Record<string, unknown> | undefined;
      const pts = route?.points;
      if (typeof b.name !== 'string' || b.name.length > 80 || !num(b.lat, -90, 90) || !num(b.lon, -180, 180)) throw new HttpError(400, '잘못된 목적지');
      if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_ROUTE_POINTS || !pts.every((p) => Array.isArray(p) && num(p[0], -90, 90) && num(p[1], -180, 180))) throw new HttpError(400, '잘못된 경로');
      if (!num(route?.distanceM, 0, 5_000_000) || !num(route?.durationS, 0, 1_000_000)) throw new HttpError(400, '잘못된 경로');
      return unwrap(
        await r.setDest(userId, { name: b.name, lat: b.lat as number, lon: b.lon as number }, { points: pts as Array<[number, number]>, distanceM: route!.distanceM as number, durationS: route!.durationS as number }),
      );
    }
    case 'course':
      return unwrap(await r.setCourse(userId, validRoomCourse(b)));
    case 'leave':
      return unwrap(await r.leave(userId));
    default:
      throw new HttpError(404);
  }
}

/** 팀 방에서 방장이 순서를 바꾸면 팀이 기억한다: 방에 있는 사람은 새 순서로, 없는 사람은 예전 순서대로 그 뒤에 */
async function rememberTeamOrder(env: Cloudflare.Env, st: RoomState): Promise<void> {
  const row = await env.DB.prepare('SELECT order_json FROM teams WHERE id = ?').bind(st.teamId).first<{ order_json: string | null }>();
  let prev: string[] = [];
  try {
    prev = row?.order_json ? (JSON.parse(row.order_json) as string[]) : [];
  } catch {
    prev = [];
  }
  const now = sorted(st.members).map((m) => m.userId);
  const next = [...now, ...prev.filter((id) => !now.includes(id))];
  await env.DB.prepare('UPDATE teams SET order_json = ? WHERE id = ?').bind(JSON.stringify(next), st.teamId).run();
}

const MAX_COURSE_POINTS = 3000;
const isGate = (v: unknown): v is Gate => {
  const g = v as Gate | null;
  return !!g && num(g.lat, -90, 90) && num(g.lon, -180, 180) && num(g.bearingDeg, -360, 360) && num(g.widthM, 1, 200);
};
/** 방장이 보낸 코스 모양 검사 (모양만 새로 만들어 저장한다 — 다른 칸이 따라 들어오지 않게) */
function validRoomCourse(b: Record<string, unknown>): RoomCourse {
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length < 1 || name.length > 40) throw new HttpError(400, '잘못된 코스 이름');
  if (b.kind !== 'loop' && b.kind !== 'point_to_point') throw new HttpError(400, '잘못된 코스 종류');
  if (!num(b.lengthM, 0, 100_000)) throw new HttpError(400, '잘못된 코스 길이');
  if (!isGate(b.startGate) || !isGate(b.finishGate)) throw new HttpError(400, '잘못된 출발선·도착선');
  const key = b.key ?? null;
  if (key !== null && (typeof key !== 'string' || !/^[bs]:.+/.test(key) || key.length > 80)) throw new HttpError(400, '잘못된 코스 열쇠');
  const sb = b.sectorBoundsM ?? null;
  if (sb !== null && !(Array.isArray(sb) && sb.length === 2 && sb.every((x) => num(x, 0, 100_000)))) throw new HttpError(400, '잘못된 구간');
  const line = b.line;
  if (!Array.isArray(line) || line.length === 1 || line.length > MAX_COURSE_POINTS || !line.every((p) => Array.isArray(p) && p.length === 2 && num(p[0], -90, 90) && num(p[1], -180, 180))) throw new HttpError(400, '잘못된 코스 선');
  const gate = (g: Gate): Gate => ({ lat: g.lat, lon: g.lon, bearingDeg: g.bearingDeg, widthM: g.widthM });
  return { name, kind: b.kind, lengthM: b.lengthM as number, key: key as string | null, startGate: gate(b.startGate), finishGate: gate(b.finishGate), sectorBoundsM: sb as [number, number] | null, line: line as Array<[number, number]> };
}

export async function roomCourse(env: Cloudflare.Env, roomId: string, userId: string): Promise<(RoomCourse & { version: number }) | null> {
  await guarded(env, roomId, userId);
  return unwrap<(RoomCourse & { version: number }) | null>(await room(env, roomId).courseShape(userId));
}

export async function roomRoute(env: Cloudflare.Env, roomId: string, userId: string): Promise<RoomRoute | null> {
  await guarded(env, roomId, userId);
  return unwrap<RoomRoute | null>(await room(env, roomId).route(userId));
}

/** 웹소켓 /group/{id}: 참가자만 */
export async function connectRoom(env: Cloudflare.Env, roomId: string, userId: string): Promise<Response> {
  const r = room(env, roomId);
  if (!(await r.isMember(userId))) throw new HttpError(403, '방 참가자만 할 수 있어요');
  await guarded(env, roomId, userId);
  return r.fetch(new Request('https://room/connect', { headers: { Upgrade: 'websocket', 'X-User-Id': userId } }));
}
