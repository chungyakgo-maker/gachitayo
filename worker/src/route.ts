// 목적지 길찾기 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.1·6, 사용자 결정 "네이버 쓰는김에 네이버 길찾기"):
// 네이버 클라우드 Maps 길찾기(Directions 15)를 대신 부른다. 키는 서버에만 있다. 계정당 하루 횟수만 세고 좌표는 남기지 않는다.
//   POST /api/route {from: {lat, lon}, to: {lat, lon}, headingDeg?, vehicle?, alt?}  →  {distanceM, durationS, points: [[위도, 경도], …], destName}
// (headingDeg는 받기만 한다: 네이버 길찾기에는 출발 진행 방향 칸이 없다)
// 바이크(vehicle: 'bike', 2026-11-18 바이크 모드): 이륜차는 고속도로·자동차전용도로를 못 다닌다(도로교통법 63조).
//   네이버 옵션 "자동차 전용 도로 회피 우선"·"무료 우선"·"편한 길" 세 경로를 한 번에 받아, 경로의 도로 이름에 자동차 전용 도로가 없는 것부터 고른다.
//   "회피 우선"이라 섞일 수 있으니 섞인 도로 이름(warnRoads)을 돌려주고, alt로 다음 후보 경로를 고를 수 있다(alts = 후보 수).
import { HttpError } from './http';
import { countUsage } from './usage';

/** 계정당 하루 길찾기 횟수 (다시 찾기 포함) */
export const ROUTE_LIMIT_PER_DAY = 300;
const NAVER_DIRECTIONS = 'https://maps.apigw.ntruss.com/map-direction-15/v1/driving';
const TIMEOUT_MS = 8000;
const MAX_POINTS = 20000;
/** 한국 범위 */
const KOREA = { latMin: 32, latMax: 39.5, lonMin: 124, lonMax: 132.5 };
const NO_SERVER = '길찾기 서버가 응답하지 않아요';

export interface RouteResult {
  distanceM: number;
  durationS: number;
  /** [위도, 경도] */
  points: Array<[number, number]>;
  /** 마지막 도로 중 이름이 있는 것 (목적지 근처 이름으로 쓴다) */
  destName: string | null;
  /** 바이크 경로만: 바이크 경로라는 표시 */
  vehicle?: 'bike';
  /** 바이크 경로만: 경로에 섞인 자동차 전용 도로 이름 (없으면 빈 목록) */
  warnRoads?: string[];
  /** 바이크 경로만: 지금 후보 번호와 후보 수 ("다른 길로 다시 찾기") */
  alt?: number;
  alts?: number;
}

interface NaverRoute {
  summary?: { distance?: number; duration?: number };
  path?: Array<[number, number]>;
  section?: Array<{ name?: string }>;
}

/** 바이크 경로 후보 순서: 자동차 전용 도로 회피 우선 → 무료 우선(고속도로는 거의 유료) → 편한 길 */
export const BIKE_OPTIONS = ['traavoidcaronly', 'traavoidtoll', 'tracomfort'] as const;
/** 이름으로 알아보는 자동차 전용 도로 (고속도로 등은 이름 규칙으로, 아래는 이름에 표시가 없는 큰 도로) */
const CAR_ONLY_WORD = /고속도로|고속국도|고속화도로|도시고속|자동차전용|순환고속/;
const CAR_ONLY_NAMES = new Set([
  '올림픽대로',
  '강변북로',
  '내부순환로',
  '북부간선도로',
  '동부간선도로',
  '서부간선도로',
  '강남순환로',
  '분당수서로',
  '분당내곡로',
  '자유로',
  '제2자유로',
  '신월여의지하도로',
  '서울외곽순환도로',
  '동서고가로',
  '신천대로',
]);
export const isCarOnlyRoad = (name: string): boolean => CAR_ONLY_WORD.test(name) || CAR_ONLY_NAMES.has(name.replace(/\s+/g, ''));
const warnRoadsOf = (r: NaverRoute): string[] => [...new Set((r.section ?? []).map((s) => s.name ?? '').filter((n) => n && isCarOnlyRoad(n)))];

export function koreaPoint(v: unknown, outside = '한국 안에서만 길찾기가 돼요'): { lat: number; lon: number } {
  const p = v as { lat?: unknown; lon?: unknown } | null;
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) throw new HttpError(400, '위치가 올바르지 않아요');
  if (p.lat < KOREA.latMin || p.lat > KOREA.latMax || p.lon < KOREA.lonMin || p.lon > KOREA.lonMax) throw new HttpError(400, outside);
  return { lat: p.lat, lon: p.lon };
}
export const inKorea = (lat: number, lon: number): boolean => lat >= KOREA.latMin && lat <= KOREA.latMax && lon >= KOREA.lonMin && lon <= KOREA.lonMax;

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export async function findRoute(env: Cloudflare.Env, userId: string, body: unknown, now = Date.now()): Promise<RouteResult> {
  const b = body as { from?: unknown; to?: unknown; vehicle?: unknown; alt?: unknown } | null;
  const bike = b?.vehicle === 'bike';
  const alt = typeof b?.alt === 'number' && Number.isInteger(b.alt) && b.alt >= 0 && b.alt < 10 ? b.alt : 0;
  const from = koreaPoint(b?.from);
  const to = koreaPoint(b?.to);
  const id = env.NCP_MAP_CLIENT_ID;
  const secret = env.NCP_MAP_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(503, '길찾기를 쓸 수 없어요');
  // 부르기 전에 센다 (실패한 요청도 사용량이므로)
  await countUsage(env, 'route_usage', userId, now, ROUTE_LIMIT_PER_DAY, '오늘 길찾기를 너무 많이 했어요. 내일 다시 해 주세요');

  const u = new URL(NAVER_DIRECTIONS);
  u.searchParams.set('start', `${from.lon},${from.lat}`);
  u.searchParams.set('goal', `${to.lon},${to.lat}`);
  if (bike) u.searchParams.set('option', BIKE_OPTIONS.join(':'));
  let r: Response;
  try {
    r = await fetch(u.href, { headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, NO_SERVER);
  }
  if (!r.ok) throw new HttpError(502, NO_SERVER);
  let j: { code?: number; message?: string; route?: Record<string, NaverRoute[]> };
  try {
    j = (await r.json()) as typeof j;
  } catch {
    throw new HttpError(502, NO_SERVER);
  }
  if (j.code !== 0) throw new HttpError(404, j.message || `경로를 찾지 못했어요 (${j.code})`);
  let route = j.route ? Object.values(j.route)[0]?.[0] : undefined;
  let bikeInfo: Pick<RouteResult, 'vehicle' | 'warnRoads' | 'alt' | 'alts'> = {};
  if (bike && j.route) {
    // 같은 길이 여러 옵션으로 나오면 하나로. 자동차 전용 도로가 없는 경로가 앞, 그 안에서는 옵션 순서
    const seen = new Set<string>();
    const cands: Array<{ r: NaverRoute; warn: string[] }> = [];
    for (const o of BIKE_OPTIONS) {
      const r = j.route[o]?.[0];
      if (!r) continue;
      const key = `${r.summary?.distance}/${r.path?.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push({ r, warn: warnRoadsOf(r) });
    }
    cands.sort((x, y) => Number(x.warn.length > 0) - Number(y.warn.length > 0));
    const c = cands[alt % Math.max(1, cands.length)];
    if (c) {
      route = c.r;
      bikeInfo = { vehicle: 'bike', warnRoads: c.warn, alt: alt % cands.length, alts: cands.length };
    }
  }
  if (!route) throw new HttpError(502, NO_SERVER);

  const points: Array<[number, number]> = [];
  for (const v of route.path ?? []) {
    if (!Array.isArray(v) || typeof v[0] !== 'number' || typeof v[1] !== 'number') continue;
    const p: [number, number] = [round6(v[1]), round6(v[0])];
    const last = points[points.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    points.push(p);
  }
  if (points.length < 2 || points.length > MAX_POINTS) throw new HttpError(502, NO_SERVER);
  let destName: string | null = null;
  for (const s of route.section ?? []) if (s.name) destName = s.name;
  return { distanceM: route.summary?.distance ?? 0, durationS: Math.round((route.summary?.duration ?? 0) / 1000), points, destName, ...bikeInfo };
}
