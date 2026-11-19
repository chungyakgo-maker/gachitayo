// 팀 방 코스 → 출발점 안내, 진짜 routeNav 와 group 을 같이 (검토 지적: routeNav 를 흉내 내서, 코스를 고르면 안내가 꺼지는 것을 못 봤다)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSnapshot } from '../../src/engine/live/livePipeline';

const h = vi.hoisted(() => ({
  phase: 'idle',
  course: null as null | { id: string },
  courseChosen: false,
  driveCbs: new Set<() => void>(),
  live: null as null | ((s: unknown) => void),
}));
const LOCAL = { id: 'local-1', name: '유명산 업힐' };
vi.mock('../../src/app/account', () => ({ getAuth: () => ({ userId: 'me', token: 'tok' }), friendlyServerError: (e: unknown) => String(e) }));
vi.mock('../../src/app/drive', () => ({
  getDriveState: () => ({ phase: h.phase, course: h.course, courseChosen: h.courseChosen }),
  driveBusy: () => false,
  subscribeDrive: (cb: () => void) => {
    h.driveCbs.add(cb);
    return () => h.driveCbs.delete(cb);
  },
  subscribeLive: (cb: (s: unknown) => void) => {
    h.live = cb;
    return () => {
      h.live = null;
    };
  },
  beginPrepare: vi.fn(),
  chooseCourse: (c: { id: string } | null) => {
    h.course = c;
    h.courseChosen = true;
  },
  chooseFreeDrive: vi.fn(),
  notePrepareError: vi.fn(),
}));
vi.mock('../../src/app/recording', () => ({ subscribeSamples: () => () => {} }));
vi.mock('../../src/app/teamCourse', async (orig) => ({
  ...(await orig<typeof import('../../src/app/teamCourse')>()),
  courseForRoom: async () => LOCAL,
  refreshTeamCourse: async () => LOCAL,
}));
vi.mock('../../src/server/config', () => ({ serverConfig: { apiUrl: 'https://api.test' } }));

const G = (lat: number) => ({ lat, lon: 127.5, bearingDeg: 0, widthM: 30 });
const ROOM = {
  roomId: '11111111-1111-4111-8111-111111111111',
  code: '482917',
  members: [
    { userId: 'host', nickname: '방장', color: 0, order: 1, host: true },
    { userId: 'me', nickname: '나', color: 1, order: 2, host: false },
  ],
  gapS: 2,
  dest: { name: '유명산 업힐 · 출발점', lat: 37.5, lon: 127.5 },
  course: { name: '유명산 업힐', kind: 'point_to_point', lengthM: 7800, key: null },
  routeVersion: 1,
};
const COURSE = { ...ROOM.course, startGate: G(37.5), finishGate: G(37.57), sectorBoundsM: null, line: [[37.5, 127.5], [37.57, 127.5]], version: 1 };
const routeCalls: unknown[] = [];
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });

const group = await import('../../src/app/group');
const nav = await import('../../src/app/routeNav');
const { setWebSocketFactoryForTest } = await import('../../src/app/liveLink');

beforeEach(() => {
  h.phase = 'idle';
  h.course = null;
  h.courseChosen = false;
  routeCalls.length = 0;
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  setWebSocketFactoryForTest(() => ({ send: () => {}, close: () => {}, readyState: 1 }) as unknown as WebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/api/rooms/join')) return json({ roomId: ROOM.roomId });
      if (url.endsWith('/course')) return json(COURSE);
      if (url.endsWith('/api/route')) {
        routeCalls.push(JSON.parse(String(init.body)));
        return new Promise<Response>(() => {});
      }
      return json(ROOM);
    }),
  );
  group.leaveGroupLocal();
  nav.stopNav();
});
afterEach(() => vi.unstubAllGlobals());

const snap = (t: number) => ({ t, state: { speedKmh: 0, status: { gpsWeak: false } }, frame: 'session', origin: { lat: 37.4, lon: 127.4 }, pos: { x: 0, y: 0, psi: 0 }, gps: { ready: true, hAcc: 5, ageMs: 100 } }) as unknown as LiveSnapshot;

describe('팀 방 코스 출발 → 출발점 안내 (진짜 routeNav)', () => {
  it('받은 코스로 출발 준비하면 그 코스가 골라지고, 출발점까지 안내가 이어지며 내 위치에서 길을 찾는다', async () => {
    await group.joinGroupRoom('482917');
    await vi.waitFor(() => expect(group.getGroup().offer?.course).toBeTruthy());
    await group.acceptRouteOffer();
    h.phase = 'preparing';
    for (const cb of [...h.driveCbs]) cb();
    await vi.waitFor(() => expect(h.course).toEqual(LOCAL));
    expect(nav.getNavLive()).not.toBeNull();
    // 라이브 스냅숏이 와도 안내가 꺼지지 않는다 (예전에는 코스를 골라서 바로 꺼졌다)
    h.live!(snap(1000));
    expect(nav.getNavLive()).not.toBeNull();
    expect(routeCalls).toHaveLength(1);
    expect(routeCalls[0]).toMatchObject({ to: { lat: 37.5, lon: 127.5 } });
  });
});
