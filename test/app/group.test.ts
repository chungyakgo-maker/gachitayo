// 그룹 주행 앱 상태 (설계 docs/superpowers/specs/2026-11-16-group-drive-design.md)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  phase: 'idle',
  nav: null as unknown,
  driveCb: null as null | (() => void),
  sampleCb: null as null | ((e: unknown) => void),
  navRoutes: [] as Array<{ route: unknown; dest: unknown }>,
}));
vi.mock('../../src/app/account', () => ({ getAuth: () => ({ userId: 'me', token: 'tok' }) }));
vi.mock('../../src/app/drive', () => ({
  getDriveState: () => ({ phase: h.phase }),
  subscribeDrive: (cb: () => void) => {
    h.driveCb = cb;
    return () => {
      h.driveCb = null;
    };
  },
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
  getNavLive: () => h.nav,
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
let routeStatus = 200;
let roomStatus = 200;
let routeVersion = 1;
let fetchRoom: ReturnType<typeof ROOM> | null = null;

const group = await import('../../src/app/group');
const { setWebSocketFactoryForTest } = await import('../../src/app/liveLink');

beforeEach(() => {
  storage.clear();
  socks.length = 0;
  calls.length = 0;
  h.phase = 'idle';
  h.nav = null;
  h.navRoutes.length = 0;
  routeVersion = 1;
  fetchRoom = null;
  routeStatus = 200;
  roomStatus = 200;
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
      if (url.endsWith('/route')) return json(routeStatus, { ...ROUTE, version: routeVersion });
      if (/\/api\/rooms\/[0-9a-f-]+$/.test(url)) {
        if (roomStatus === 0) throw new TypeError('Failed to fetch');
        return roomStatus === 200 ? json(200, fetchRoom ?? ROOM()) : json(roomStatus, { error: '방을 찾지 못했어요' });
      }
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
    expect(JSON.parse(storage.getItem('gachitayo.groupRoom.v1')!)).toEqual({ roomId: ROOM().roomId, accepted: 0 });
    expect(socks[0]!.url).toBe(`wss://api.test/group/${ROOM().roomId}`);
  });

  it('팀 주행: 방 id로 바로 들어가고, 팀 이름이 방 상태에 실린다', async () => {
    fetchRoom = ROOM({ code: '', teamId: 'team-1', teamName: '북악 새벽팀' });
    await group.enterGroupRoom(ROOM().roomId);
    expect(calls[0]).toMatchObject({ method: 'GET', url: `https://api.test/api/rooms/${ROOM().roomId}` });
    expect(group.getGroup().room).toMatchObject({ teamId: 'team-1', teamName: '북악 새벽팀' });
    expect(socks[0]!.url).toBe(`wss://api.test/group/${ROOM().roomId}`);
    msg({ type: 'state', ...ROOM({ code: '', teamId: 'team-1', teamName: '북악 새벽팀', gapS: 3 }) });
    expect(group.getGroup().room).toMatchObject({ teamName: '북악 새벽팀', gapS: 3 });
  });

  it('다른 방에 있다가 팀 주행 방으로 들어가면 예전 방은 서버에서도 나간다 (검토 지적)', async () => {
    await group.joinGroupRoom('482917');
    const other = '22222222-2222-4222-8222-222222222222';
    fetchRoom = ROOM({ roomId: other, code: '', teamId: 'team-1', teamName: '팀' });
    await group.enterGroupRoom(other);
    expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', url: `https://api.test/api/rooms/${ROOM().roomId}/leave` }));
    expect(group.getGroup().room?.teamId).toBe('team-1');
  });

  it('정식 빌드(위치 공유 끔): 팀 방에 붙어 순서·목적지는 받지만 내 위치는 안 보내고 남의 위치는 버린다', async () => {
    vi.stubEnv('VITE_LOCATION_SHARING', 'off');
    try {
      await group.joinGroupRoom('482917');
      h.phase = 'driving';
      // 다른 테스트의 "마지막으로 보낸 시각"에 영향을 주지 않게 오래전 시각
      h.sampleCb!({ kind: 'gps', s: { tFix: 1.0e12, lat: 37.5, lon: 127, speed: 10, heading: 90, hAcc: 5 } });
      expect(socks[0]!.sent).toEqual([]);
      msg({ type: 'pos', userId: 'host', t: 1.8e12, lat: 37.5, lon: 127, speed: 10, heading: 90, hAcc: 5 });
      expect(group.getGroupPoints()).toEqual({});
      msg({ type: 'state', ...ROOM({ gapS: 3 }) });
      expect(group.getGroup().room!.gapS).toBe(3);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('정식 빌드(위치 공유 끔) 방장: 목적지만 보내고 내 위치에서 시작하는 경로는 보내지 않는다 (검토 지적)', async () => {
    vi.stubEnv('VITE_LOCATION_SHARING', 'off');
    try {
      await group.joinGroupRoom('482917');
      calls.length = 0;
      await group.shareGroupDestination({ name: '팔각정', lat: 37.6, lon: 126.98 }, { points: [[37.5, 127], [37.55, 127.01], [37.6, 126.98]], distanceM: 15000, durationS: 1500, destName: '팔각정' });
      const body = calls.find((c) => c.url.endsWith('/dest'))!.body as { route: { points: Array<[number, number]>; distanceM: number } };
      expect(body.route.distanceM).toBe(0);
      for (const [a, b] of body.route.points) expect(Math.abs(a - 37.6) + Math.abs(b - 126.98)).toBeLessThan(0.0001);
    } finally {
      vi.unstubAllEnvs();
    }
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
    expect(group.getGroupPoints().host).toHaveLength(2);
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
    routeVersion = 2;
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

describe('그룹 주행 상태 (검토 지적)', () => {
  const D = { name: '만항재', lat: 37.51, lon: 127.01 };
  const routeGets = () => calls.filter((c) => c.url.endsWith('/route')).length;

  it('accepted route guides every drive start, not just the first', async () => {
    await group.joinGroupRoom('482917');
    msg({ type: 'state', ...ROOM({ dest: D, routeVersion: 1 }) });
    await vi.waitFor(() => expect(group.getGroup().offer).not.toBeNull());
    group.acceptRouteOffer();
    for (let i = 0; i < 2; i++) {
      h.phase = 'preparing';
      h.driveCb!();
      h.phase = 'idle';
      h.driveCb!();
    }
    expect(h.navRoutes).toHaveLength(2);
    // 이미 다른 안내 중이면(목적지 화면에서 출발) 건드리지 않는다
    h.nav = { route: 'other' };
    h.phase = 'preparing';
    h.driveCb!();
    expect(h.navRoutes).toHaveLength(2);
  });

  it('an accepted route that the host has since replaced is not used', async () => {
    await group.joinGroupRoom('482917');
    msg({ type: 'state', ...ROOM({ dest: D, routeVersion: 1 }) });
    await vi.waitFor(() => expect(group.getGroup().offer).not.toBeNull());
    group.acceptRouteOffer();
    routeVersion = 2;
    msg({ type: 'state', ...ROOM({ dest: { ...D, name: '두문동재' }, routeVersion: 2 }) });
    await vi.waitFor(() => expect(group.getGroup().offer?.version).toBe(2));
    group.dismissRouteOffer();
    group.startGroupNav();
    expect(h.navRoutes).toHaveLength(0);
  });

  it('the same version is fetched once and not offered again after answering', async () => {
    await group.joinGroupRoom('482917');
    msg({ type: 'state', ...ROOM({ dest: D, routeVersion: 1 }) });
    msg({ type: 'state', ...ROOM({ dest: D, routeVersion: 1 }) });
    await vi.waitFor(() => expect(group.getGroup().offer).not.toBeNull());
    group.acceptRouteOffer();
    msg({ type: 'state', ...ROOM({ dest: D, routeVersion: 1 }) });
    await new Promise((r) => setTimeout(r, 10));
    expect(routeGets()).toBe(1);
    expect(group.getGroup().offer).toBeNull();
  });

  it('a route of another version is ignored', async () => {
    await group.joinGroupRoom('482917');
    routeVersion = 3;
    msg({ type: 'state', ...ROOM({ dest: D, routeVersion: 1 }) });
    await new Promise((r) => setTimeout(r, 10));
    expect(group.getGroup().offer).toBeNull();
  });

  it('reopening the app keeps an accepted destination without asking again', async () => {
    await group.joinGroupRoom('482917');
    msg({ type: 'state', ...ROOM({ dest: D, routeVersion: 1 }) });
    await vi.waitFor(() => expect(group.getGroup().offer).not.toBeNull());
    group.acceptRouteOffer();
    const saved = storage.getItem('gachitayo.groupRoom.v1');
    group.leaveGroupLocal();
    storage.setItem('gachitayo.groupRoom.v1', saved!);
    fetchRoom = ROOM({ dest: D, routeVersion: 1 });
    await group.resumeGroupRoom();
    await new Promise((r) => setTimeout(r, 10));
    expect(group.getGroup().offer).toBeNull();
    expect(group.hasPendingRoute()).toBe(true);
  });

  it('resume keeps the room when offline, forgets it when the room is gone', async () => {
    storage.setItem('gachitayo.groupRoom.v1', JSON.stringify({ roomId: ROOM().roomId, accepted: 0 }));
    roomStatus = 0;
    await group.resumeGroupRoom();
    expect(storage.getItem('gachitayo.groupRoom.v1')).not.toBeNull();
    roomStatus = 404;
    await group.resumeGroupRoom();
    expect(storage.getItem('gachitayo.groupRoom.v1')).toBeNull();
    expect(group.getGroup().room).toBeNull();
  });

  it('an invite join started while resuming wins', async () => {
    storage.setItem('gachitayo.groupRoom.v1', JSON.stringify({ roomId: 'old-room', accepted: 0 }));
    const resume = group.resumeGroupRoom();
    await group.joinGroupRoom('482917');
    await resume;
    expect(group.getGroup().room!.roomId).toBe(ROOM().roomId);
    expect(socks.at(-1)!.url).toContain(ROOM().roomId);
  });

  it('a late close from an old connection does not mark the new one disconnected', async () => {
    await group.joinGroupRoom('482917');
    const old = socks.at(-1)!;
    await group.joinGroupRoom('482917');
    socks.at(-1)!.onopen?.();
    old.onclose?.();
    expect(group.getGroup().connected).not.toBe(false);
  });
});
