// 그룹 주행 방 (설계 docs/superpowers/specs/2026-11-16-group-drive-design.md): 실제 Workers 런타임의 Durable Object와 웹소켓
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/index';
import { createRoom, ROOM_CODE_MISSES_PER_HOUR, ROOM_TTL_MS } from '../src/group';

const ORIGIN = 'https://example.github.io';
let ip = 0;
async function call(method: string, path: string, init: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, 'CF-Connecting-IP': `10.11.${Math.floor(++ip / 200)}.${ip % 200}` };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return handle(new Request(`https://api.example.workers.dev${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), env);
}
async function user(nickname: string) {
  return (await (await call('POST', '/auth/signup', { body: { nickname } })).json()) as { userId: string; token: string };
}
type Member = { userId: string; nickname: string; color: number; order: number; host: boolean };
type Room = { roomId: string; code: string; members: Member[]; gapS: number; dest: { name: string; lat: number; lon: number } | null; routeVersion: number };
async function create(t: { token: string }) {
  const r = await call('POST', '/api/rooms', { token: t.token });
  expect(r.status).toBe(200);
  return (await r.json()) as { roomId: string; code: string };
}
const state = async (id: string, t: { token: string }) => (await (await call('GET', `/api/rooms/${id}`, { token: t.token })).json()) as Room;
function connect(id: string, token: string | null) {
  const headers: Record<string, string> = { Origin: ORIGIN, Upgrade: 'websocket' };
  if (token) headers['Sec-WebSocket-Protocol'] = `gachitayo, ${token}`;
  return handle(new Request(`https://api.example.workers.dev/group/${id}`, { headers }), env);
}
function open(res: Response) {
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const got: Array<Record<string, unknown>> = [];
  ws.accept();
  ws.addEventListener('message', (e) => got.push(JSON.parse(e.data as string)));
  return { ws, got };
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('그룹 주행 방', () => {
  it('host creates a 6-digit room and is member 1', async () => {
    const h = await user('방장');
    const { roomId, code } = await create(h);
    expect(code).toMatch(/^\d{6}$/);
    const s = await state(roomId, h);
    expect(s.code).toBe(code);
    expect(s.members).toEqual([{ userId: h.userId, nickname: '방장', color: 0, order: 1, host: true, avatar: null }]);
    expect(s.gapS).toBe(2);
    expect(s.dest).toBeNull();
  });

  it('others join by code with distinct colors, up to 8', async () => {
    const h = await user('방장');
    const { roomId, code } = await create(h);
    const people = [];
    for (let i = 0; i < 7; i++) {
      const u = await user(`친구${i + 1}`);
      const r = await call('POST', '/api/rooms/join', { token: u.token, body: { code } });
      expect(r.status).toBe(200);
      expect(((await r.json()) as { roomId: string }).roomId).toBe(roomId);
      people.push(u);
    }
    const s = await state(roomId, h);
    expect(s.members.map((m) => m.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(s.members.map((m) => m.color)).size).toBe(8);
    const late = await user('늦은 친구');
    const full = await call('POST', '/api/rooms/join', { token: late.token, body: { code } });
    expect(full.status).toBe(409);
    expect(((await full.json()) as { error: string }).error).toBe('방이 가득 찼어요');
    // 다시 들어와도 한 자리
    expect((await call('POST', '/api/rooms/join', { token: people[0]!.token, body: { code } })).status).toBe(200);
    expect((await state(roomId, h)).members).toHaveLength(8);
  });

  it('unknown code is 404, outsiders cannot read the room', async () => {
    const h = await user('방장');
    const { roomId } = await create(h);
    const x = await user('남');
    const r = await call('POST', '/api/rooms/join', { token: x.token, body: { code: '000000' } });
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: string }).error).toBe('방을 찾지 못했어요');
    expect((await call('GET', `/api/rooms/${roomId}`, { token: x.token })).status).toBe(403);
  });

  it('host reorders, sets gap and destination with route; members cannot', async () => {
    const h = await user('방장');
    const { roomId, code } = await create(h);
    const a = await user('친구1');
    await call('POST', '/api/rooms/join', { token: a.token, body: { code } });
    expect((await call('POST', `/api/rooms/${roomId}/order`, { token: a.token, body: { userIds: [a.userId, h.userId] } })).status).toBe(403);
    expect((await call('POST', `/api/rooms/${roomId}/order`, { token: h.token, body: { userIds: [a.userId, h.userId] } })).status).toBe(200);
    expect((await state(roomId, a)).members.map((m) => [m.nickname, m.order])).toEqual([
      ['친구1', 1],
      ['방장', 2],
    ]);
    expect((await call('POST', `/api/rooms/${roomId}/gap`, { token: h.token, body: { gapS: 0.5 } })).status).toBe(400);
    expect((await call('POST', `/api/rooms/${roomId}/gap`, { token: h.token, body: { gapS: 3.5 } })).status).toBe(200);
    expect((await state(roomId, a)).gapS).toBe(3.5);
    const route = { points: [[37.5, 127], [37.51, 127.01]], distanceM: 1500, durationS: 120 };
    expect((await call('POST', `/api/rooms/${roomId}/dest`, { token: h.token, body: { name: '만항재', lat: 37.51, lon: 127.01, route } })).status).toBe(200);
    const s = await state(roomId, a);
    expect(s.dest).toEqual({ name: '만항재', lat: 37.51, lon: 127.01 });
    expect(s.routeVersion).toBe(1);
    expect(await (await call('GET', `/api/rooms/${roomId}/route`, { token: a.token })).json()).toEqual({ ...route, version: 1 });
  });

  it('positions are relayed to the other members with who sent them', async () => {
    const h = await user('방장');
    const { roomId, code } = await create(h);
    const a = await user('친구1');
    await call('POST', '/api/rooms/join', { token: a.token, body: { code } });
    const hs = open(await connect(roomId, h.token));
    const as = open(await connect(roomId, a.token));
    await until(() => as.got.some((m) => m.type === 'state'));
    hs.ws.send(JSON.stringify({ t: Date.now(), lat: 37.5, lon: 127, speed: 10, heading: 90 }));
    await until(() => as.got.some((m) => m.type === 'pos'));
    expect(as.got.find((m) => m.type === 'pos')).toMatchObject({ type: 'pos', userId: h.userId, lat: 37.5, lon: 127, speed: 10 });
    // 보낸 사람에게는 되돌려 보내지 않는다
    expect(hs.got.some((m) => m.type === 'pos')).toBe(false);
    // 방장이 바꾸면 모두에게 상태가 간다
    as.got.length = 0;
    await call('POST', `/api/rooms/${roomId}/gap`, { token: h.token, body: { gapS: 4 } });
    await until(() => as.got.some((m) => m.type === 'state'));
    expect(as.got.find((m) => m.type === 'state')).toMatchObject({ gapS: 4 });
    hs.ws.close();
    as.ws.close();
  });

  it('outsiders cannot connect', async () => {
    const h = await user('방장');
    const { roomId } = await create(h);
    const x = await user('남');
    expect((await connect(roomId, x.token)).status).toBe(403);
    expect((await connect(roomId, null)).status).toBe(401);
  });

  it('leaving removes the member and keeps order numbers tight', async () => {
    const h = await user('방장');
    const { roomId, code } = await create(h);
    const a = await user('친구1');
    const b = await user('친구2');
    await call('POST', '/api/rooms/join', { token: a.token, body: { code } });
    await call('POST', '/api/rooms/join', { token: b.token, body: { code } });
    expect((await call('POST', `/api/rooms/${roomId}/leave`, { token: a.token })).status).toBe(200);
    expect((await state(roomId, h)).members.map((m) => [m.nickname, m.order])).toEqual([
      ['방장', 1],
      ['친구2', 2],
    ]);
  });
});

describe('그룹 주행 방 (검토 지적)', () => {
  it('wrong codes are limited per account per hour', async () => {
    const u = await user('남');
    for (let i = 0; i < ROOM_CODE_MISSES_PER_HOUR; i++) {
      const r = await call('POST', '/api/rooms/join', { token: u.token, body: { code: String(900000 + i) } });
      expect(r.status).toBe(404);
    }
    const h = await user('방장');
    const { code } = await create(h);
    // 맞는 코드도 한 시간 동안 막힌다
    expect((await call('POST', '/api/rooms/join', { token: u.token, body: { code } })).status).toBe(429);
  });

  it('a room closes 24 hours after it was made: no state, no route, no socket, no join', async () => {
    const h = await user('방장');
    const { roomId, code } = await createRoom(env, h.userId, Date.now() - ROOM_TTL_MS - 60_000);
    expect((await call('GET', `/api/rooms/${roomId}`, { token: h.token })).status).toBe(404);
    expect((await call('GET', `/api/rooms/${roomId}/route`, { token: h.token })).status).toBe(404);
    expect((await connect(roomId, h.token)).status).toBe(403);
    const a = await user('친구');
    expect((await call('POST', '/api/rooms/join', { token: a.token, body: { code } })).status).toBe(404);
  });

  it('the closing alarm cuts sockets and deletes the room', async () => {
    const h = await user('방장');
    const { roomId } = await create(h);
    const hs = open(await connect(roomId, h.token));
    let closed = false;
    hs.ws.addEventListener('close', () => (closed = true));
    expect(await runDurableObjectAlarm(env.GROUP.get(env.GROUP.idFromName(roomId)))).toBe(true);
    await until(() => closed);
    expect(closed).toBe(true);
    expect((await call('GET', `/api/rooms/${roomId}`, { token: h.token })).status).toBe(404);
  });

  it('if nobody is host (the lone host left), the next person to join becomes host', async () => {
    const h = await user('방장');
    const { roomId, code } = await create(h);
    await call('POST', `/api/rooms/${roomId}/leave`, { token: h.token });
    await call('POST', '/api/rooms/join', { token: h.token, body: { code } });
    expect((await state(roomId, h)).members).toMatchObject([{ userId: h.userId, host: true }]);
  });

  it('route comes with its version', async () => {
    const h = await user('방장');
    const { roomId } = await create(h);
    const route = { points: [[37.5, 127], [37.51, 127.01]], distanceM: 1500, durationS: 120 };
    await call('POST', `/api/rooms/${roomId}/dest`, { token: h.token, body: { name: '만항재', lat: 37.51, lon: 127.01, route } });
    await call('POST', `/api/rooms/${roomId}/dest`, { token: h.token, body: { name: '두문동재', lat: 37.52, lon: 127.02, route } });
    expect(await (await call('GET', `/api/rooms/${roomId}/route`, { token: h.token })).json()).toMatchObject({ version: 2, distanceM: 1500 });
  });

  it('positions: too frequent or wrong clock are dropped', async () => {
    const h = await user('방장');
    const { roomId, code } = await create(h);
    const a = await user('친구');
    await call('POST', '/api/rooms/join', { token: a.token, body: { code } });
    const hs = open(await connect(roomId, h.token));
    const as = open(await connect(roomId, a.token));
    await until(() => as.got.some((m) => m.type === 'state'));
    hs.ws.send(JSON.stringify({ t: Date.now() + 10 * 60_000, lat: 37.5, lon: 127 }));
    hs.ws.send(JSON.stringify({ t: Date.now(), lat: 37.6, lon: 127 }));
    hs.ws.send(JSON.stringify({ t: Date.now(), lat: 37.7, lon: 127 }));
    await until(() => as.got.some((m) => m.type === 'pos'));
    await new Promise((r) => setTimeout(r, 100));
    expect(as.got.filter((m) => m.type === 'pos').map((m) => m.lat)).toEqual([37.6]);
    hs.ws.close();
    as.ws.close();
  });
});
