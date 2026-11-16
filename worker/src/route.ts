// 목적지 길찾기 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.1, 사용자 요청 "카카오로 경로검색 및 설정후 표지판 주행"):
// 디고 앱 키로 카카오모빌리티 자동차 길찾기를 대신 부른다. 키는 서버에만 있다. 계정당 하루 횟수만 세고 좌표는 남기지 않는다.
//   POST /api/route {from: {lat, lon}, to: {lat, lon}, headingDeg?}  →  {distanceM, durationS, points: [[위도, 경도], …], destName}
import { HttpError } from './http';

/** 계정당 하루 길찾기 횟수 (재탐색 포함) */
export const ROUTE_LIMIT_PER_DAY = 300;
const KAKAO_DIRECTIONS = 'https://apis-navi.kakaomobility.com/v1/directions';
const TIMEOUT_MS = 8000;
const MAX_POINTS = 20000;
/** 한국 범위 (카카오 길찾기가 되는 곳) */
const KOREA = { latMin: 32, latMax: 39.5, lonMin: 124, lonMax: 132.5 };

export interface RouteResult {
  distanceM: number;
  durationS: number;
  /** [위도, 경도] */
  points: Array<[number, number]>;
  /** 마지막 도로 중 이름이 있는 것 (목적지 근처 이름으로 쓴다) */
  destName: string | null;
}

interface KakaoRoad {
  name?: string;
  vertexes?: number[];
}
interface KakaoRoute {
  result_code?: number;
  result_msg?: string;
  summary?: { distance?: number; duration?: number };
  sections?: Array<{ roads?: KakaoRoad[] }>;
}

function point(v: unknown): { lat: number; lon: number } {
  const p = v as { lat?: unknown; lon?: unknown } | null;
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) throw new HttpError(400, '위치가 올바르지 않아요');
  if (p.lat < KOREA.latMin || p.lat > KOREA.latMax || p.lon < KOREA.lonMin || p.lon > KOREA.lonMax) throw new HttpError(400, '한국 안에서만 길찾기가 돼요');
  return { lat: p.lat, lon: p.lon };
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** 한국 날짜 (YYYY-MM-DD) */
const kstDay = (now: number) => new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);

export async function findRoute(env: Cloudflare.Env, userId: string, body: unknown, now = Date.now()): Promise<RouteResult> {
  const b = body as { from?: unknown; to?: unknown; headingDeg?: unknown } | null;
  const from = point(b?.from);
  const to = point(b?.to);
  const heading = typeof b?.headingDeg === 'number' && Number.isFinite(b.headingDeg) ? ((Math.round(b.headingDeg) % 360) + 360) % 360 : null;
  const key = env.KAKAO_REST_API_KEY;
  if (!key) throw new HttpError(503, '길찾기를 쓸 수 없어요');

  // 부르기 전에 센다 (실패한 요청도 카카오 사용량이므로)
  const row = await env.DB.prepare('INSERT INTO route_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(userId, kstDay(now))
    .first<{ count: number }>();
  if ((row?.count ?? 0) > ROUTE_LIMIT_PER_DAY) throw new HttpError(429, '오늘 길찾기를 너무 많이 했어요. 내일 다시 해 주세요');

  const u = new URL(KAKAO_DIRECTIONS);
  u.searchParams.set('origin', `${from.lon},${from.lat}${heading === null ? '' : `,angle=${heading}`}`);
  u.searchParams.set('destination', `${to.lon},${to.lat}`);
  u.searchParams.set('priority', 'RECOMMEND');
  let r: Response;
  try {
    r = await fetch(u.href, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, '길찾기 서버가 응답하지 않아요');
  }
  if (!r.ok) throw new HttpError(502, '길찾기 서버가 응답하지 않아요');
  let route: KakaoRoute | undefined;
  try {
    route = ((await r.json()) as { routes?: KakaoRoute[] }).routes?.[0];
  } catch {
    route = undefined;
  }
  if (!route) throw new HttpError(502, '길찾기 서버가 응답하지 않아요');
  if (route.result_code !== 0) throw new HttpError(404, route.result_msg || `경로를 찾지 못했어요 (${route.result_code})`);

  const points: Array<[number, number]> = [];
  let destName: string | null = null;
  for (const sec of route.sections ?? [])
    for (const road of sec.roads ?? []) {
      if (road.name) destName = road.name;
      const v = road.vertexes ?? [];
      for (let i = 0; i + 1 < v.length; i += 2) {
        const p: [number, number] = [round6(v[i + 1]!), round6(v[i]!)];
        const last = points[points.length - 1];
        if (last && last[0] === p[0] && last[1] === p[1]) continue;
        points.push(p);
      }
    }
  if (points.length < 2 || points.length > MAX_POINTS) throw new HttpError(502, '길찾기 서버가 응답하지 않아요');
  return { distanceM: route.summary?.distance ?? 0, durationS: route.summary?.duration ?? 0, points, destName };
}
