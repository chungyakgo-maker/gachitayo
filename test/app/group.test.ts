// 그룹 주행 앱 상태 (설계 docs/superpowers/specs/2026-11-16-group-drive-design.md)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  phase: 'idle',
  sampleCb: null as null | ((e: unknown) => void),
  navRoutes: [] as Array<{ route: unknown; dest: unknown }>,
}));
vi.mock('../../src/app/account', () => ({ getAuth: () => ({ userId: 'me', token: 'tok' }) }));
vi.mock('../../src/app/drive', () => ({
  getDriveState: () => ({ phase: h.phase }),
  subscribeDrive: () => () => {},
  beginPrepare: vi.fn(),
  chooseCourse: vi.fn(),
  chooseFreeDrive: vi.fn(),
}));
vi.mock('../../src/app/recording', () => ({
  subscribeSamples: (cb: (e: unknown) => void) => {
    h.sampleCb = cb;
    return () => {
      h.sampleCb = null;
    };
  },
}));
vi.mock('../../src/app/routeNav', () => ({
  startNavWithRoute: (route: unknown, dest: unknown) => h.navRoutes.push({ route, dest }),
  replaceNavRoute: (route: unknown, dest: unknown) => h.navRoutes.push({ route, dest }),
  getNavLive: () => null,
}));
vi.mock('../../src/server/config', () => ({ serverConfig: { apiUrl: 'https://api.test' } }));

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const storage = new MemoryStorage();
type Sock = { url: string; sent: string[]; onopen: (() => void) | null; onmessage: ((e: { data: string }) => void) | null; onclose: (() => void) | null; onerror: (() => void) | null; readyState: number; send: (s: string) => void; close: () => void };
const socks: Sock[] = [];
const calls: Array<{ method: string; url: string; body: unknown }> = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ROOM = (over: Record<string, unknown> = {}) => ({
  roomId: '11111111-1111-4111-8111-111111111111',
  code: '482917',
  members: [
    { userId: 'a', nickname: '친구1', color: 1, order: 1, host: false },
    { userId: 'host', nickname: '방장', color: 0, order: 2, host: true },
    { userId: 'me', nickname: '나', color: 2, order: 3, host: false },
  ],
  gapS: 2,
  dest: null,
  routeVersion: 0,
  ...over,
});
const ROUTE = { points: [[37.5, 127], [37.51, 127.01]], distanceM: 1500, durationS: 120 };

const group = await import('../../src/app/group');
const { setWebSocketFactoryForTest } = await import('../../src/app/liveLink');

beforeEach(() => {
  storage.clear();
  socks.length = 0;
  calls.length = 0;
  h.phase = 'idle';
  h.navRoutes.length = 0;
  vi.stubGlobal('localStorage', storage);
  setWebSocketFactoryForTest((url) => {
    const s: Sock = { url, sent: [], onopen: null, onmessage: null, onclose: null, onerror: null, readyState: 1, send: (m) => s.sent.push(m), close: () => {} };
    socks.push(s);
    return s as unknown as WebSocket;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: init.method ?? 'GET', url, body });
      if (url.endsWith('/api/rooms') && init.method === 'POST') return json(200, { roomId: ROOM().roomId, code: '482917' });
      if (url.endsWith('/api/rooms/join')) return json(200, { roomId: ROOM().roomId });
      if (url.endsWith('/route')) return json(200, ROUTE);
      if (/\/api\/rooms\/[0-9a-f-]+$/.test(url)) return json(200, ROOM());
      return json(200, ROOM());
    }),
  );
  group.leaveGroupLocal();
});
afterEach(() => vi.unstubAllGlobals());
const msg = (o: unknown) => socks.at(-1)!.onmessage!({ data: JSON.stringify(o) });

describe('그룹 주행 상태', () => {
  it('joining by code opens the room, remembers it and connects', async () => {
    await group.joinGroupRoom('482917');
    expect(calls[0]).toEqual({ method: 'POST', url: 'https://api.test/api/rooms/join', body: { code: '482917' } });
    expect(group.getGroup().room!.code).toBe('482917');
    expect(storage.getItem('gachitayo.groupRoom.v1')).toBe(ROOM().roomId);
    expect(socks[0]!.url).toBe(`wss://api.test/group/${ROOM().roomId}`);
  });

  it('front member is the one right before me; first has none', async () => {
    await group.joinGroupRoom('482917');
    expect(group.frontMember(group.getGroup())!.nickname).toBe('방장');
    msg({ type: 'state', ...ROOM({ members: [{ userId: 'me', nickname: '나', color: 2, order: 1, host: false }, { userId: 'host', nickname: '방장', color: 0, order: 2, host: true }] }) });
    expect(group.frontMember(group.getGroup())).toBeNull();
  });

  it('positions from others are kept per member', async () => {
    await group.joinGroupRoom('482917');
    msg({ type: 'pos', userId: 'host', t: 1.8e12, lat: 37.5, lon: 127, speed: 10, heading: 90, hAcc: 5 });
    msg({ type: 'pos', userId: 'host', t: 1.8e12 + 1000, lat: 37.5001, lon: 127, speed: 10, heading: 90, hAcc: 5 });
    expect(group.getGroup().points.host).toHaveLength(2);
  });

  it('a new destination is offered to members; accepting starts the route', async () => {
    await group.joinGroupRoom('482917');
    msg({ type: 'state', ...ROOM({ dest: { name: '만항재', lat: 37.51, lon: 127.01 }, routeVersion: 1 }) });
    await vi.waitFor(() => expect(group.getGroup().offer).not.toBeNull());
    expect(group.getGroup().offer).toMatchObject({ version: 1, dest: { name: '만항재' }, route: { distanceM: 1500 } });
    group.acceptRouteOffer();
    expect(group.getGroup().offer).toBeNull();
    // 대기실에서는 출발할 때 켠다
    expect(h.navRoutes).toHaveLength(0);
    group.startGroupNav();
    expect(h.navRoutes).toHaveLength(1);
    // 같은 판은 다시 묻지 않는다
    msg({ type: 'state', ...ROOM({ dest: { name: '만항재', lat: 37.51, lon: 127.01 }, routeVersion: 1 }) });
    await new Promise((r) => setTimeout(r, 10));
    expect(group.getGroup().offer).toBeNull();
  });

  it('a destination changed while driving replaces the route right away', async () => {
    await group.joinGroupRoom('482917');
    h.phase = 'driving';
    msg({ type: 'state', ...ROOM({ dest: { name: '만항재', lat: 37.51, lon: 127.01 }, routeVersion: 2 }) });
    await vi.waitFor(() => expect(group.getGroup().offer).not.toBeNull());
    group.acceptRouteOffer();
    expect(h.navRoutes).toHaveLength(1);
  });

  it('sends my GPS only while driving', async () => {
    await group.joinGroupRoom('482917');
    h.sampleCb!({ kind: 'gps', s: { tFix: 1.8e12, lat: 37.5, lon: 127, speed: 10, heading: 90, hAcc: 5 } });
    expect(socks[0]!.sent).toEqual([]);
    h.phase = 'driving';
    h.sampleCb!({ kind: 'gps', s: { tFix: 1.8e12, lat: 37.5, lon: 127, speed: 10, heading: 90, hAcc: 5 } });
    expect(JSON.parse(socks[0]!.sent[0]!)).toEqual({ t: 1.8e12, lat: 37.5, lon: 127, speed: 10, heading: 90, hAcc: 5 });
  });

  it('host actions call the room API', async () => {
    await group.createGroupRoom();
    msg({ type: 'state', ...ROOM({ members: [{ userId: 'me', nickname: '나', color: 0, order: 1, host: true }] }) });
    await group.setGroupGap(3);
    await group.setGroupOrder(['me']);
    await group.shareGroupDestination({ name: '만항재', lat: 37.51, lon: 127.01 }, ROUTE as never);
    const posts = calls.filter((c) => c.method === 'POST').map((c) => [c.url.replace('https://api.test', ''), c.body]);
    expect(posts.slice(1)).toEqual([
      [`/api/rooms/${ROOM().roomId}/gap`, { gapS: 3 }],
      [`/api/rooms/${ROOM().roomId}/order`, { userIds: ['me'] }],
      [`/api/rooms/${ROOM().roomId}/dest`, { name: '만항재', lat: 37.51, lon: 127.01, route: ROUTE }],
    ]);
  });

  it('leaving tells the server and forgets the room', async () => {
    await group.joinGroupRoom('482917');
    await group.leaveGroupRoom();
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: `https://api.test/api/rooms/${ROOM().roomId}/leave` });
    expect(group.getGroup().room).toBeNull();
    expect(storage.getItem('gachitayo.groupRoom.v1')).toBeNull();
  });

  it('colors: 8 distinct', () => {
    expect(new Set(group.GROUP_COLORS).size).toBe(8);
  });
});
