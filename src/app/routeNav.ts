// 목적지로 주행 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.3·6, 사용자 요청 "경로검색 및 설정후 표지판 주행", "'만항재' 검색하면 나와야"):
// 목적지 화면의 계획(목적지·경로·기록 남기기)과 주행 중 경로 안내(RouteGuide, 다시 찾기, 도착), 최근 목적지.
// 일반 주행 위에 얹는다: 코스·랩 엔진은 그대로이고, 주행 화면은 코스가 없을 때 이 안내로 표지판·경로 선을 그린다.
import { isDestOnly } from './destOnly';
import { useSyncExternalStore } from 'react';
import { ApiError, apiFetch } from '../server/api';
import { fromLocal, toLocal, type LatLon } from '../engine/geo';
import type { LiveSnapshot } from '../engine/live/livePipeline';
import { bearingOfPsi, ROUTE, RouteGuide, type RouteStep } from '../engine/route/routeGuide';
import type { Course } from '../types/course';
import { getAuth } from './account';
import { getSettings, subscribeSettings } from './settings';
import { beginPrepare, chooseCourse, chooseFreeDrive, driveBusy, getDriveState, subscribeDrive, subscribeLive } from './drive';

export interface Destination {
  lat: number;
  lon: number;
  name: string;
  kind: 'map' | 'search' | 'course-start' | 'course-finish' | 'recent';
}

export interface RouteData {
  distanceM: number;
  durationS: number;
  /** [위도, 경도] */
  points: Array<[number, number]>;
  destName: string | null;
  /** 바이크 경로 (탈것이 바이크일 때 서버가 고속도로·자동차전용도로를 피해 찾은 경로) */
  vehicle?: 'bike';
  /** 바이크 경로에 섞였을 수 있는 자동차 전용 도로 이름 */
  warnRoads?: string[];
  /** 바이크 경로 후보 번호·수 ("다른 길로 다시 찾기") */
  alt?: number;
  alts?: number;
}

export interface RoutePlan {
  dest: Destination | null;
  route: RouteData | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** 기록 남기기 (기본 켬): 켜면 일반 기록 주행, 끄면 일반 주행(기록 안 남김) */
  record: boolean;
}

export interface NavLive {
  /** 주행 평면(스냅숏 원점) 기준 경로 안내 */
  guide: RouteGuide;
  route: RouteData;
  step: RouteStep | null;
  status: 'guiding' | 'off' | 'rerouting' | 'arrived';
}

/** 지도에서 찍은 곳의 이름 (도로 이름을 못 받으면) */
export const MAP_PICK_NAME = '지도에서 고른 곳';
const NET_ERROR = '통신이 안 돼요. 잠시 뒤 다시 해 주세요';
const NO_ACCOUNT = '계정이 있어야 길찾기를 쓸 수 있어요';
const RECENT_KEY = 'gachitayo.recentDest.v1';
const RECENT_MAX = 5;
/** 이 안이면 같은 곳 (m) */
const SAME_PLACE_M = 30;
/** 길찾기 요청 제한 시간 (산길에서 통신이 멈춰도 "새 경로 찾는 중"에 갇히지 않게) */
const ROUTE_TIMEOUT_MS = 10_000;

const distM = (a: LatLon, b: LatLon) => {
  const p = toLocal(a, b.lat, b.lon);
  return Math.hypot(p.x, p.y);
};
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const errText = (e: unknown) => (e instanceof ApiError ? e.message : NET_ERROR);

const bikeNow = () => getSettings().vehicle === 'bike';

/** 탈것이 바이크면 바이크 경로(서버가 고속도로·자동차전용도로를 피함)를 묻는다. alt: 바이크 경로의 다음 후보 */
async function requestRoute(from: LatLon, to: LatLon, headingDeg?: number, alt = 0): Promise<RouteData> {
  const auth = getAuth();
  if (!auth) throw new ApiError(401, NO_ACCOUNT);
  const bike = bikeNow() ? { vehicle: 'bike', ...(alt > 0 ? { alt } : {}) } : {};
  const body = { from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon }, ...(headingDeg === undefined ? {} : { headingDeg }), ...bike };
  return apiFetch<RouteData>('POST', '/api/route', { token: auth.token, body, signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
}

/** 코스 만들기 (2026-11-26): 출발지 → 도착지 길찾기 (탈것이 바이크면 바이크 길). 실패하면 화면에 보일 글로 던진다 */
export async function findRouteBetween(from: LatLon, to: LatLon, alt = 0): Promise<RouteData> {
  if (!online()) throw new Error(NET_ERROR);
  try {
    return await requestRoute(from, to, undefined, alt);
  } catch (e) {
    throw new Error(errText(e));
  }
}

/** 장소 검색 결과 (네이버 지역 검색, 서버 /api/places) */
export interface Place {
  name: string;
  category: string;
  address: string;
  lat: number;
  lon: number;
}

/** 장소 이름·주소로 찾는다 (최대 5개). 실패하면 화면에 보일 글로 던진다 */
export async function findPlaces(q: string): Promise<Place[]> {
  const auth = getAuth();
  if (!auth) throw new Error(NO_ACCOUNT);
  try {
    return await apiFetch<Place[]>('GET', `/api/places?q=${encodeURIComponent(q.trim())}`, { token: auth.token, signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
  } catch (e) {
    throw new Error(errText(e));
  }
}

// ── 목적지 화면의 계획 ─────────────────────────────────

let plan: RoutePlan = { dest: null, route: null, status: 'idle', error: null, record: true };
const planListeners = new Set<() => void>();
function setPlan(patch: Partial<RoutePlan>): void {
  plan = { ...plan, ...patch };
  planListeners.forEach((l) => l());
}
export const getPlan = (): RoutePlan => plan;
export function usePlan(): RoutePlan {
  return useSyncExternalStore((cb) => {
    planListeners.add(cb);
    return () => planListeners.delete(cb);
  }, getPlan);
}

let planSeq = 0;

/** 목적지까지 경로를 받는다. 그 사이 다른 목적지를 고르면 늦게 온 응답은 버린다 */
export async function planTo(dest: Destination, from: LatLon, alt = 0): Promise<void> {
  const seq = ++planSeq;
  setPlan({ dest, route: null, status: 'loading', error: null });
  try {
    const route = await requestRoute(from, dest, undefined, alt);
    if (seq !== planSeq) return;
    const name = dest.kind === 'map' ? (route.destName ? `${route.destName} 부근` : MAP_PICK_NAME) : dest.name;
    setPlan({ dest: { ...dest, name }, route, status: 'ready' });
  } catch (e) {
    if (seq !== planSeq) return;
    setPlan({ status: 'error', error: errText(e) });
  }
}

/** 바이크 경로에 자동차 전용 도로가 섞였을 때 "다른 길로 다시 찾기": 서버가 준 다음 후보 경로 (후보가 하나면 그대로) */
export async function planOtherRoute(from: LatLon): Promise<void> {
  const { dest, route } = plan;
  if (!dest || !route || !route.alts || route.alts < 2) return;
  await planTo(dest, from, ((route.alt ?? 0) + 1) % route.alts);
}

export function setRecord(on: boolean): void {
  setPlan({ record: on });
}

export function clearPlan(): void {
  planSeq++;
  setPlan({ dest: null, route: null, status: 'idle', error: null, record: true });
}

// ── 다른 화면에서 고른 목적지 넘기기 (메인 검색 결과, 코스 창의 "출발점으로 길찾기") ──

let handed: Destination | null = null;

/** 목적지 화면으로 넘길 목적지를 맡긴다 (목적지 화면이 열리면서 한 번 가져간다) */
export function handOffDestination(d: Destination): void {
  handed = d;
}

/** 맡긴 목적지 (가져간 뒤에는 clearHandedDestination으로 비운다: React 개발 모드가 초기값 함수를 두 번 불러도 같은 값이게) */
export const peekHandedDestination = (): Destination | null => handed;

export function clearHandedDestination(): void {
  handed = null;
}

// ── 최근 목적지 · 코스 목적지 ──────────────────────────

export function recentDestinations(): Destination[] {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    if (!Array.isArray(a)) return [];
    return a
      .filter((d): d is Destination => !!d && typeof d.lat === 'number' && typeof d.lon === 'number' && typeof d.name === 'string')
      .slice(0, RECENT_MAX)
      .map((d) => ({ lat: d.lat, lon: d.lon, name: d.name, kind: 'recent' as const }));
  } catch {
    return [];
  }
}

/** 맨 앞에 넣는다. 30 m 안에 있던 곳은 빼고 (같은 곳), 5개까지 */
export function rememberDestination(d: Destination): void {
  const list = recentDestinations().filter((r) => distM(r, d) > SAME_PLACE_M);
  list.unshift({ lat: d.lat, lon: d.lon, name: d.name, kind: 'recent' });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // 저장소를 못 쓰면 최근 목적지 없이
  }
}

/** 코스 출발점·도착점 (랩 코스는 출발점 하나, 이름만). 지금 위치를 알면 가까운 순 */
export function courseDestinations(courses: Course[], from: LatLon | null): Array<Destination & { distanceM: number | null }> {
  const out: Destination[] = [];
  for (const c of courses) {
    const loop = c.kind === 'loop';
    out.push({ lat: c.startGate.lat, lon: c.startGate.lon, name: loop ? c.name : `${c.name} · 출발점`, kind: 'course-start' });
    if (!loop) out.push({ lat: c.finishGate.lat, lon: c.finishGate.lon, name: `${c.name} · 도착점`, kind: 'course-finish' });
  }
  const list = out.map((d) => ({ ...d, distanceM: from ? distM(from, d) : null }));
  if (from) list.sort((a, b) => a.distanceM! - b.distanceM!);
  return list;
}

// ── 주행 중 안내 ──────────────────────────────────────

let nav: NavLive | null = null;
let navDest: LatLon | null = null;
const navListeners = new Set<() => void>();
function setNav(n: NavLive | null): void {
  nav = n;
  navListeners.forEach((l) => l());
}
export const getNavLive = (): NavLive | null => nav;
export function useNavLive(): NavLive | null {
  return useSyncExternalStore((cb) => {
    navListeners.add(cb);
    return () => navListeners.delete(cb);
  }, getNavLive);
}

/** 멈추거나 새로 시작하면 올린다 (그 전에 보낸 다시 찾기 응답은 버린다) */
let navSeq = 0;
let inflight = false;
let lastReqAt = -Infinity;
let unsubs: Array<() => void> = [];
/** 목적지만 받은 경로라 내 위치에서 바로 찾아야 한다 */
let rerouteNow = false;

/** 목적지 화면의 "이 경로로 출발": 탭 처리 안에서 바로 주행 준비를 연다 (아이폰 모션 권한) */
export function startRouteDrive(): void {
  const { dest, route, record, status } = plan;
  if (status !== 'ready' || !dest || !route) return;
  // 이미 주행·기록 중이면 손대지 않는다 (진행 중인 주행을 일반 주행으로 바꿔 기록을 지우지 않게)
  if (driveBusy()) return;
  rememberDestination(dest);
  stopNav();
  beginPrepare();
  if (record) chooseCourse(null);
  else chooseFreeDrive();
  // 내가 찾은 경로: 그때 탈것으로 찾았으니 다시 찾지 않는다 (서버가 예전이라 바이크 표시가 없어도, 검토 지적: 출발마다 길찾기 한 번 더)
  startNavWithRoute(route, dest, true);
}

/** 목적지만 받은 경로이거나, 남이 준 경로(팀 방장)인데 나는 바이크이고 바이크 경로가 아니면 내 위치에서 다시 찾는다 */
const needOwnRoute = (route: RouteData, own = false): boolean => isDestOnly(route) || (!own && bikeNow() && route.vehicle !== 'bike');

// 안내 중에 탈것을 바이크로 바꾸면(주행 준비 화면 등) 자동차 경로를 그대로 두지 않고 내 위치에서 바이크 경로로 다시 찾는다 (검토 지적)
let lastVehicle = getSettings().vehicle;
subscribeSettings(() => {
  const v = getSettings().vehicle;
  if (v === lastVehicle) return;
  lastVehicle = v;
  if (v === 'bike' && nav && nav.route.vehicle !== 'bike') rerouteNow = true;
});

/** 팀 방 코스의 출발점까지 안내할 때 그 코스 번호 (3부). 이 코스를 고른 동안은 안내를 끝내지 않는다 */
let navCourseId: string | null = null;

/** 이 경로로 안내를 켠다 (목적지 화면의 출발, 그룹 주행의 방장 경로). 주행 준비는 부른 쪽이 연다. own: 이 폰에서 찾은 경로.
 *  toCourse: 팀 방 코스의 출발점까지 안내 — 그 코스를 골라도 안내를 이어 간다 (검토 지적: 코스를 고르면 안내가 바로 꺼졌다) */
export function startNavWithRoute(route: RouteData, dest: LatLon, own = false, toCourse: string | null = null): void {
  stopNav();
  const first = route.points[0]!;
  navDest = { lat: dest.lat, lon: dest.lon };
  navCourseId = toCourse;
  // 목적지만 받은 경로(정식 빌드 팀 주행)면 내 위치가 잡히는 대로 내 위치에서 찾는다.
  // 바이크인데 바이크 경로가 아니면(방장이 자동차) 고속도로가 섞일 수 있어 내 위치에서 바이크 경로로 다시 찾는다
  rerouteNow = needOwnRoute(route, own);
  setNav({ guide: new RouteGuide(route.points, { lat: first[0], lon: first[1] }), route, step: null, status: 'guiding' });
  unsubs = [
    subscribeLive((s) => {
      if (s) navTick(s);
    }),
    subscribeDrive(() => {
      if (getDriveState().phase === 'idle') stopNav();
    }),
  ];
}

/** 주행 중 경로를 바꾼다 (그룹 주행: 방장이 목적지를 새로 정함). 안내가 꺼져 있으면 켠다 */
export function replaceNavRoute(route: RouteData, dest: LatLon, toCourse: string | null = null): void {
  if (!nav) {
    startNavWithRoute(route, dest, false, toCourse);
    return;
  }
  navCourseId = toCourse;
  navSeq++;
  inflight = false;
  lastReqAt = -Infinity;
  navDest = { lat: dest.lat, lon: dest.lon };
  rerouteNow = needOwnRoute(route);
  setNav({ guide: new RouteGuide(route.points, nav.guide.origin), route, step: null, status: 'guiding' });
}

export function stopNav(): void {
  rerouteNow = false;
  navCourseId = null;
  navSeq++;
  inflight = false;
  lastReqAt = -Infinity;
  navDest = null;
  for (const u of unsubs) u();
  unsubs = [];
  if (nav) setNav(null);
}

/** 경로 위면 다시 찾는 중이어도 안내(표지판)를 보인다 */
const statusOf = (step: RouteStep): NavLive['status'] => (step.arrived ? 'arrived' : step.onRoute ? 'guiding' : inflight ? 'rerouting' : 'off');

/** 스냅숏 하나 (10 Hz). 주행 단계에서만 경로 위치를 따라가고 다시 찾는다 */
export function navTick(snap: LiveSnapshot, now = Date.now()): void {
  const n = nav;
  if (!n) return;
  // 준비 화면에서 코스를 고르면 코스 주행 (경로 안내를 끝낸다: 뒤에서 다시 찾기를 계속 보내지 않게).
  // 팀 방 코스의 출발점 안내는 그 코스를 고른 동안 이어 간다
  const chosen = getDriveState().course;
  if (chosen && chosen.id !== navCourseId) {
    stopNav();
    return;
  }
  if (!snap.pos || !snap.origin) return;
  // 목적지만 받은 경로: 준비 중이어도 내 위치에서 한 번 찾는다
  if (rerouteNow && !inflight && online()) {
    rerouteNow = false;
    reroute(snap, (snap.state?.speedKmh ?? 0) / 3.6, now);
  }
  // 주행 평면 원점이 바뀌면(첫 GPS 등) 경로를 새 원점으로 다시 만든다
  const guide = n.guide.origin.lat === snap.origin.lat && n.guide.origin.lon === snap.origin.lon ? n.guide : new RouteGuide(n.route.points, snap.origin);
  if (getDriveState().phase !== 'driving') {
    if (guide !== n.guide) setNav({ ...n, guide });
    return;
  }
  const v = (snap.state?.speedKmh ?? 0) / 3.6;
  const gpsOk = snap.gps.ready && !(snap.state?.status.gpsWeak ?? false);
  const step = guide.update({ t: snap.t, x: snap.pos.x, y: snap.pos.y, v, gpsOk });
  if (step.wantReroute && !inflight && now - lastReqAt >= ROUTE.rerouteGapMs && online()) reroute(snap, v, now);
  setNav({ ...n, guide, step, status: statusOf(step) });
}

function reroute(snap: LiveSnapshot, v: number, now: number): void {
  const to = navDest;
  if (!to || !snap.pos || !snap.origin) return;
  inflight = true;
  lastReqAt = now;
  const seq = navSeq;
  const here = fromLocal(snap.origin, snap.pos.x, snap.pos.y);
  const heading = v >= ROUTE.headingMinMps ? bearingOfPsi(snap.pos.psi) : undefined;
  requestRoute(here, to, heading).then(
    (route) => {
      if (seq !== navSeq || !nav) return;
      inflight = false;
      setNav({ guide: new RouteGuide(route.points, nav.guide.origin), route, step: null, status: 'guiding' });
    },
    () => {
      // 예전 경로를 그대로 두고 간격이 지나면 다시
      if (seq !== navSeq || !nav) return;
      inflight = false;
      setNav({ ...nav, status: nav.step ? statusOf(nav.step) : 'guiding' });
    },
  );
}

export { destOnlyRoute, isDestOnly } from './destOnly';
