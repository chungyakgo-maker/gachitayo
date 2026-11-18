// 경로 안내 상태 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.3): 목적지·경로 받기·주행 중 재탐색·도착·최근 목적지
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromLocal, toLocal } from '../../src/engine/geo';
import type { LiveSnapshot } from '../../src/engine/live/livePipeline';
import type { Course } from '../../src/types/course';

const h = vi.hoisted(() => ({
  phase: 'driving',
  busy: false,
  course: null as unknown,
  live: null as null | ((s: unknown) => void),
  drv: null as null | (() => void),
  beginPrepare: vi.fn(),
  chooseCourse: vi.fn(),
  chooseFreeDrive: vi.fn(),
}));
vi.mock('../../src/app/drive', () => ({
  getDriveState: () => ({ phase: h.phase, course: h.course }),
  driveBusy: () => h.busy,
  subscribeLive: (cb: (s: unknown) => void) => {
    h.live = cb;
    return () => {
      h.live = null;
    };
  },
  subscribeDrive: (cb: () => void) => {
    h.drv = cb;
    return () => {
      h.drv = null;
    };
  },
  beginPrepare: () => h.beginPrepare(),
  chooseCourse: (c: unknown) => h.chooseCourse(c),
  chooseFreeDrive: () => h.chooseFreeDrive(),
}));
vi.mock('../../src/app/account', () => ({ getAuth: () => ({ userId: 'u1', token: 'tok' }) }));

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

const nav = await import('../../src/app/routeNav');
const { bearingOfPsi } = await import('../../src/engine/route/routeGuide');

const O = { lat: 37.5, lon: 127 };
const FROM = { lat: 37.5, lon: 127 };
const ll = (x: number, y: number, o = O): [number, number] => {
  const p = fromLocal(o, x, y);
  return [p.lat, p.lon];
};
/** 북쪽 300 m → 반지름 40 m 오른쪽 → 동쪽 300 m */
function routePoints(): Array<[number, number]> {
  const xy: Array<[number, number]> = [];
  for (let y = 0; y <= 300; y += 30) xy.push([0, y]);
  for (let a = 172.5; a >= 90; a -= 7.5) xy.push([40 + 40 * Math.cos((a * Math.PI) / 180), 300 + 40 * Math.sin((a * Math.PI) / 180)]);
  for (let x = 70; x <= 340; x += 45) xy.push([x, 340]);
  return xy.map(([x, y]) => ll(x, y));
}
const ROUTE_A = { distanceM: 663, durationS: 90, points: routePoints(), destName: '남산공원길' };
const ROUTE_B = { distanceM: 400, durationS: 60, points: [ll(200, 100), ll(600, 100)], destName: null };

// ── 서버 흉내: 응답을 테스트가 정한다 ─────────────────────
const pending: Array<{ url: string; body: { from: { lat: number; lon: number }; to: { lat: number; lon: number }; headingDeg?: number }; auth: string | null; signal: AbortSignal | null; resolve: (r: Response) => void; reject: (e: unknown) => void }> = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
beforeEach(() => {
  pending.length = 0;
  storage.clear();
  vi.stubGlobal('localStorage', storage);
  h.phase = 'driving';
  h.busy = false;
  h.course = null;
  h.beginPrepare.mockClear();
  h.chooseCourse.mockClear();
  h.chooseFreeDrive.mockClear();
  nav.stopNav();
  nav.clearPlan();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => pending.push({ url, body: init.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init.headers).get('Authorization'), signal: init.signal ?? null, resolve, reject })),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mapDest = (x: number, y: number) => {
  const [lat, lon] = ll(x, y);
  return { lat, lon, name: '지도에서 고른 곳', kind: 'map' as const };
};
const snap = (t: number, x: number, y: number, o = O, psi = 0, kmh = 36) =>
  ({ t, state: { speedKmh: kmh, status: { gpsWeak: false } }, frame: 'session', origin: o, pos: { x, y, psi }, gps: { ready: true, hAcc: 5, ageMs: 100 } }) as unknown as LiveSnapshot;

async function readyPlan() {
  const p = nav.planTo(mapDest(340, 340), FROM);
  pending[0]!.resolve(json(200, ROUTE_A));
  await p;
  expect(nav.getPlan().status).toBe('ready');
}
/** 경로 밖으로 3초 넘게 → 다시 찾기 요청이 하나 생긴다 */
function goOff(now: number) {
  nav.navTick(snap(0, 0, 50), now);
  nav.navTick(snap(1000, 200, 100), now);
  nav.navTick(snap(4100, 200, 100), now);
}

describe('목적지 계획', () => {
  it('plan loads route and names map pick', async () => {
    const d = mapDest(340, 340);
    const p = nav.planTo(d, FROM);
    expect(nav.getPlan().status).toBe('loading');
    expect(pending[0]!.url).toMatch(/\/api\/route$/);
    expect(pending[0]!.auth).toBe('Bearer tok');
    expect(pending[0]!.body).toEqual({ from: FROM, to: { lat: d.lat, lon: d.lon } });
    pending[0]!.resolve(json(200, ROUTE_A));
    await p;
    expect(nav.getPlan().status).toBe('ready');
    expect(nav.getPlan().dest!.name).toBe('남산공원길 부근');
    expect(nav.getPlan().route!.distanceM).toBe(663);
  });

  it('map pick without road name keeps its name', async () => {
    const p = nav.planTo(mapDest(600, 100), FROM);
    pending[0]!.resolve(json(200, ROUTE_B));
    await p;
    expect(nav.getPlan().dest!.name).toBe('지도에서 고른 곳');
  });

  it('course point keeps course name', async () => {
    const p = nav.planTo({ ...mapDest(340, 340), name: '북악 · 도착점', kind: 'course-finish' }, FROM);
    pending[0]!.resolve(json(200, ROUTE_A));
    await p;
    expect(nav.getPlan().dest!.name).toBe('북악 · 도착점');
  });

  it('stale plan response is ignored', async () => {
    const a = nav.planTo(mapDest(340, 340), FROM);
    const b = nav.planTo(mapDest(600, 100), FROM);
    pending[1]!.resolve(json(200, ROUTE_B));
    await b;
    pending[0]!.resolve(json(200, ROUTE_A));
    await a;
    expect(nav.getPlan().route!.distanceM).toBe(400);
    expect(nav.getPlan().dest!.lat).toBeCloseTo(ll(600, 100)[0], 9);
    expect(nav.getPlan().status).toBe('ready');
  });

  it('plan error shows server message', async () => {
    const p = nav.planTo(mapDest(340, 340), FROM);
    pending[0]!.resolve(json(404, { error: '도착 지점 주변의 도로를 탐색할 수 없음' }));
    await p;
    expect(nav.getPlan().status).toBe('error');
    expect(nav.getPlan().error).toBe('도착 지점 주변의 도로를 탐색할 수 없음');
  });

  it('network failure says no connection', async () => {
    const p = nav.planTo(mapDest(340, 340), FROM);
    pending[0]!.reject(new TypeError('Failed to fetch'));
    await p;
    expect(nav.getPlan().status).toBe('error');
    expect(nav.getPlan().error).toBe('통신이 안 돼요. 잠시 뒤 다시 해 주세요');
  });
});

describe('장소 검색', () => {
  it('finds places with the account token', async () => {
    const p = nav.findPlaces(' 만항재 ');
    expect(pending[0]!.url).toMatch(/\/api\/places\?q=%EB%A7%8C%ED%95%AD%EC%9E%AC$/);
    expect(pending[0]!.auth).toBe('Bearer tok');
    expect(pending[0]!.signal).toBeInstanceOf(AbortSignal);
    pending[0]!.resolve(json(200, [{ name: '만항재', category: '고개,골짜기', address: '강원특별자치도 정선군 고한읍 고한리 산216-37', lat: 37.1487091, lon: 128.8994813 }]));
    expect(await p).toEqual([{ name: '만항재', category: '고개,골짜기', address: '강원특별자치도 정선군 고한읍 고한리 산216-37', lat: 37.1487091, lon: 128.8994813 }]);
  });

  it('server error message is passed on', async () => {
    const p = nav.findPlaces('만항재');
    pending[0]!.resolve(json(429, { error: '오늘 장소 검색을 너무 많이 했어요. 내일 다시 해 주세요' }));
    await expect(p).rejects.toThrow('오늘 장소 검색을 너무 많이 했어요. 내일 다시 해 주세요');
  });

  it('network failure says no connection', async () => {
    const p = nav.findPlaces('만항재');
    pending[0]!.reject(new TypeError('Failed to fetch'));
    await expect(p).rejects.toThrow('통신이 안 돼요. 잠시 뒤 다시 해 주세요');
  });
});

describe('최근 목적지 · 코스 목적지', () => {
  it('recent keeps 5 and dedupes within 30 m', () => {
    for (let i = 0; i < 6; i++) nav.rememberDestination({ ...mapDest(i * 1000, 0), name: `곳 ${i}` });
    let r = nav.recentDestinations();
    expect(r.map((d) => d.name)).toEqual(['곳 5', '곳 4', '곳 3', '곳 2', '곳 1']);
    expect(r.every((d) => d.kind === 'recent')).toBe(true);
    nav.rememberDestination({ ...mapDest(2010, 0), name: '곳 2 다시' });
    r = nav.recentDestinations();
    expect(r).toHaveLength(5);
    expect(r[0]!.name).toBe('곳 2 다시');
    expect(r.filter((d) => d.name.startsWith('곳 2'))).toHaveLength(1);
  });

  it('courseDestinations lists start and finish by distance', () => {
    const gate = (lat: number, lon: number) => ({ lat, lon, bearingDeg: 0, widthM: 20 });
    const a = { id: 'a', name: 'A', kind: 'point_to_point', startGate: gate(37.6, 127), finishGate: gate(37.61, 127) } as unknown as Course;
    const b = { id: 'b', name: 'B', kind: 'loop', startGate: gate(37.5005, 127), finishGate: gate(37.5005, 127) } as unknown as Course;
    const list = nav.courseDestinations([a, b], FROM);
    expect(list.map((d) => d.name)).toEqual(['B', 'A · 출발점', 'A · 도착점']);
    expect(list.map((d) => d.kind)).toEqual(['course-start', 'course-start', 'course-finish']);
    expect(list[0]!.distanceM!).toBeCloseTo(55.6, 0);
    expect(nav.courseDestinations([a], null).map((d) => d.distanceM)).toEqual([null, null]);
  });
});

describe('주행 중 안내', () => {
  it('start uses record choice and remembers destination', async () => {
    await readyPlan();
    nav.startRouteDrive();
    expect(h.beginPrepare).toHaveBeenCalledTimes(1);
    expect(h.chooseCourse).toHaveBeenCalledWith(null);
    expect(nav.getNavLive()!.status).toBe('guiding');
    expect(nav.recentDestinations()[0]!.name).toBe('남산공원길 부근');
    nav.stopNav();
    nav.setRecord(false);
    nav.startRouteDrive();
    expect(h.chooseFreeDrive).toHaveBeenCalledTimes(1);
  });

  it('live snapshots drive the guide', async () => {
    await readyPlan();
    nav.startRouteDrive();
    h.live!(snap(0, 0, 100));
    const n = nav.getNavLive()!;
    expect(n.step!.onRoute).toBe(true);
    expect(n.step!.s!).toBeCloseTo(100, 0);
  });

  it('reroute after off-route uses position and heading', async () => {
    await readyPlan();
    nav.startRouteDrive();
    goOff(100_000);
    expect(pending).toHaveLength(2);
    const from = pending[1]!.body.from;
    const back = toLocal(O, from.lat, from.lon);
    expect(back.x).toBeCloseTo(200, 0);
    expect(back.y).toBeCloseTo(100, 0);
    expect(pending[1]!.body.headingDeg).toBe(bearingOfPsi(0));
    expect(nav.getNavLive()!.status).toBe('rerouting');
    pending[1]!.resolve(json(200, ROUTE_B));
    await flush();
    const n = nav.getNavLive()!;
    expect(n.route.distanceM).toBe(400);
    expect(n.guide.lengthM).toBeCloseTo(400, 0);
    expect(n.status).toBe('guiding');
  });

  it('slow driving sends no heading', async () => {
    await readyPlan();
    nav.startRouteDrive();
    nav.navTick(snap(0, 0, 50), 0);
    nav.navTick(snap(1000, 200, 100, O, 0, 5), 0);
    nav.navTick(snap(4100, 200, 100, O, 0, 5), 0);
    expect(pending[1]!.body.headingDeg).toBeUndefined();
  });

  it('failed reroute keeps route and retries after gap', async () => {
    await readyPlan();
    nav.startRouteDrive();
    goOff(100_000);
    pending[1]!.resolve(json(502, { error: '길찾기 서버가 응답하지 않아요' }));
    await flush();
    expect(nav.getNavLive()!.route.distanceM).toBe(663);
    expect(nav.getNavLive()!.status).toBe('off');
    nav.navTick(snap(5000, 200, 100), 119_000);
    expect(pending).toHaveLength(2);
    nav.navTick(snap(6000, 200, 100), 120_000);
    expect(pending).toHaveLength(3);
  });

  it('response after stop is dropped', async () => {
    await readyPlan();
    nav.startRouteDrive();
    goOff(100_000);
    nav.stopNav();
    pending[1]!.resolve(json(200, ROUTE_B));
    await flush();
    expect(nav.getNavLive()).toBeNull();
  });

  it('guide rebuilt when origin changes', async () => {
    await readyPlan();
    nav.startRouteDrive();
    nav.navTick(snap(0, 0, 50), 0);
    expect(nav.getNavLive()!.guide.origin).toEqual(O);
    const O2 = { lat: 37.501, lon: 127.001 };
    const p = toLocal(O2, ...ll(0, 100));
    nav.navTick(snap(100, p.x, p.y, O2), 0);
    const n = nav.getNavLive()!;
    expect(n.guide.origin).toEqual(O2);
    expect(n.step!.onRoute).toBe(true);
    expect(n.step!.s!).toBeCloseTo(100, 0);
  });

  it('목적지만 받은 경로(정식 빌드 팀 주행)는 내 위치가 잡히면 바로 내 위치에서 찾는다 (준비 중이어도)', async () => {
    const [lat, lon] = ll(340, 340);
    const only = nav.destOnlyRoute({ lat, lon });
    expect(nav.isDestOnly(only)).toBe(true);
    expect(nav.isDestOnly(ROUTE_A)).toBe(false);
    // 방장 위치는 실리지 않는다: 점이 모두 목적지 바로 옆
    for (const [a, b] of only.points) expect(Math.abs(a - lat) + Math.abs(b - lon)).toBeLessThan(0.0001);
    h.phase = 'preparing';
    nav.startNavWithRoute(only, { lat, lon });
    nav.navTick(snap(0, 10, 20), 100_000);
    expect(pending).toHaveLength(1);
    const from = toLocal(O, pending[0]!.body.from.lat, pending[0]!.body.from.lon);
    expect(from.x).toBeCloseTo(10, 0);
    expect(from.y).toBeCloseTo(20, 0);
    pending[0]!.resolve(json(200, ROUTE_A));
    await flush();
    expect(nav.getNavLive()!.route.distanceM).toBe(663);
    // 한 번만
    nav.navTick(snap(100, 10, 20), 100_100);
    expect(pending).toHaveLength(1);
  });

  it('only while driving', async () => {
    await readyPlan();
    nav.startRouteDrive();
    h.phase = 'preparing';
    goOff(100_000);
    expect(pending).toHaveLength(1);
  });

  it('drive ending stops nav', async () => {
    await readyPlan();
    nav.startRouteDrive();
    h.phase = 'idle';
    h.drv!();
    expect(nav.getNavLive()).toBeNull();
    expect(h.live).toBeNull();
  });

  it('start does nothing while a drive is running', async () => {
    await readyPlan();
    h.busy = true;
    nav.setRecord(false);
    nav.startRouteDrive();
    expect(h.beginPrepare).not.toHaveBeenCalled();
    expect(h.chooseCourse).not.toHaveBeenCalled();
    expect(h.chooseFreeDrive).not.toHaveBeenCalled();
    expect(nav.getNavLive()).toBeNull();
  });

  it('choosing a course stops guidance', async () => {
    await readyPlan();
    nav.startRouteDrive();
    h.course = { id: 'c1' };
    goOff(100_000);
    expect(nav.getNavLive()).toBeNull();
    expect(h.live).toBeNull();
    expect(pending).toHaveLength(1);
  });

  it('route requests have a timeout', async () => {
    const p = nav.planTo(mapDest(340, 340), FROM);
    expect(pending[0]!.signal).toBeInstanceOf(AbortSignal);
    pending[0]!.reject(new DOMException('시간 초과', 'TimeoutError'));
    await p;
    expect(nav.getPlan().error).toBe('통신이 안 돼요. 잠시 뒤 다시 해 주세요');
  });

  it('back on route while rerouting shows signs again', async () => {
    await readyPlan();
    nav.startRouteDrive();
    goOff(100_000);
    expect(nav.getNavLive()!.status).toBe('rerouting');
    expect(pending[1]!.signal).toBeInstanceOf(AbortSignal);
    nav.navTick(snap(5000, 0, 200), 105_000);
    expect(nav.getNavLive()!.status).toBe('guiding');
  });

  it('arrival shows arrived', async () => {
    await readyPlan();
    nav.startRouteDrive();
    nav.navTick(snap(0, 300, 340), 0);
    nav.navTick(snap(500, 325, 340), 0);
    expect(nav.getNavLive()!.status).toBe('arrived');
  });
});
