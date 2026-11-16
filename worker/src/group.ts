// 그룹 주행 방 (설계 docs/superpowers/specs/2026-11-16-group-drive-design.md, 사용자 요청 "방만들고 그룹주행"):
// 방마다 Durable Object 하나. 참가자(색·순서·방장), 차 간격, 목적지·경로를 저장하고, 실시간 위치는 웹소켓으로 받아 다른 참가자에게 전한다(저장 안 함).
//   POST /api/rooms            방 만들기 (만든 사람이 방장·1번) → {roomId, code}
//   POST /api/rooms/join {code} 코드로 들어가기 (8명까지) → {roomId}
//   GET  /api/rooms/{id}        방 상태 (참가자만)
//   POST /api/rooms/{id}/order {userIds} · /gap {gapS} · /dest {name, lat, lon, route} (방장만) · /leave
//   GET  /api/rooms/{id}/route  경로 점들 (참가자만)
//   웹소켓 /group/{id}          위치 보내기·받기, 방 상태 받기
import { DurableObject } from 'cloudflare:workers';
import { HttpError } from './http';
import { parseLivePoint } from './live';

export const ROOM_MAX = 8;
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
  /** 색 번호 0~7 (방 안에서 겹치지 않음) */
  color: number;
  /** 주행 순서 1부터 */
  order: number;
  host: boolean;
}
export interface Dest {
  name: string;
  lat: number;
  lon: number;
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
}
export interface RoomState extends Omit<RoomData, 'createdAt'> {
  roomId: string;
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
  private async save(d: RoomData): Promise<void> {
    await this.ctx.storage.put('room', d);
    this.broadcast(JSON.stringify({ type: 'state', ...this.view(d) }));
  }
  private view(d: RoomData): RoomState {
    const { createdAt: _c, ...rest } = d;
    return { roomId: this.ctx.id.name ?? '', ...rest, members: sorted(d.members) };
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

  async init(code: string, hostId: string, nickname: string, now = Date.now()): Promise<RoomState> {
    const d: RoomData = { code, createdAt: now, members: [{ userId: hostId, nickname, color: 0, order: 1, host: true }], gapS: 2, dest: null, routeVersion: 0 };
    await this.save(d);
    await this.ctx.storage.setAlarm(now + ROOM_TTL_MS);
    return this.view(d);
  }

  async join(userId: string, nickname: string): Promise<RoomState | Fail> {
    const d = await this.data();
    if (!d) return { error: 'missing' };
    if (!d.members.some((m) => m.userId === userId)) {
      if (d.members.length >= ROOM_MAX) return { error: 'full' };
      const used = new Set(d.members.map((m) => m.color));
      const color = [0, 1, 2, 3, 4, 5, 6, 7].find((c) => !used.has(c))!;
      // 방장이 없으면(혼자 있던 방장이 나갔다 다시 들어옴 등) 들어온 사람이 방장 (검토 지적: 아무도 목적지를 못 정했다)
      d.members.push({ userId, nickname, color, order: d.members.length + 1, host: !d.members.some((m) => m.host) });
      await this.save(d);
    }
    return this.view(d);
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
    d.routeVersion += 1;
    await this.ctx.storage.put('route', route);
    await this.save(d);
    return this.view(d);
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
    await this.save(d);
    for (const ws of this.ctx.getWebSockets(userId)) ws.close(1000, '나감');
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

const room = (env: Cloudflare.Env, roomId: string) => env.GROUP.get(env.GROUP.idFromName(roomId));

function unwrap<T>(r: unknown): T {
  if (r && typeof r === 'object' && 'error' in (r as object)) {
    const e = (r as Fail).error;
    if (e === 'forbidden') throw new HttpError(403, '방 참가자만 할 수 있어요');
    if (e === 'full') throw new HttpError(409, '방이 가득 찼어요');
    if (e === 'missing') throw new HttpError(404, '방을 찾지 못했어요');
    throw new HttpError(400, '잘못된 값');
  }
  return r as T;
}

async function nicknameOf(env: Cloudflare.Env, userId: string): Promise<string> {
  const r = await env.DB.prepare('SELECT nickname FROM users WHERE id = ?').bind(userId).first<{ nickname: string }>();
  return r?.nickname ?? '친구';
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
  await room(env, roomId).init(code, userId, await nicknameOf(env, userId), now);
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
  unwrap<RoomState>(await room(env, r.id).join(userId, await nicknameOf(env, userId)));
  return { roomId: r.id };
}

export const roomState = async (env: Cloudflare.Env, roomId: string, userId: string): Promise<RoomState> => unwrap<RoomState>(await room(env, roomId).state(userId));

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export async function roomAction(env: Cloudflare.Env, roomId: string, userId: string, action: string, body: unknown): Promise<unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  const r = room(env, roomId);
  switch (action) {
    case 'order':
      return unwrap(await r.setOrder(userId, b.userIds));
    case 'gap':
      return unwrap(await r.setGap(userId, b.gapS));
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
    case 'leave':
      return unwrap(await r.leave(userId));
    default:
      throw new HttpError(404);
  }
}

export const roomRoute = async (env: Cloudflare.Env, roomId: string, userId: string): Promise<RoomRoute | null> => unwrap<RoomRoute | null>(await room(env, roomId).route(userId));

/** 웹소켓 /group/{id}: 참가자만 */
export async function connectRoom(env: Cloudflare.Env, roomId: string, userId: string): Promise<Response> {
  const r = room(env, roomId);
  if (!(await r.isMember(userId))) throw new HttpError(403, '방 참가자만 할 수 있어요');
  return r.fetch(new Request('https://room/connect', { headers: { Upgrade: 'websocket', 'X-User-Id': userId } }));
}
