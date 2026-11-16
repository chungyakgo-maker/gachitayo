// 장소 검색 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 6, 사용자 요청 "'만항재' 검색하면 나와야"):
// 네이버 클라우드 NAVER API HUB 지역 검색을 대신 부른다. 키는 서버에만. 계정당 하루 횟수만 세고 검색어는 남기지 않는다.
//   GET /api/places?q=만항재  →  [{name, category, address, lat, lon}] (최대 5개, 네이버 순서 그대로)
import { HttpError } from './http';
import { inKorea } from './route';
import { countUsage } from './usage';

/** 계정당 하루 장소 검색 횟수 */
export const SEARCH_LIMIT_PER_DAY = 500;
const NAVER_LOCAL = 'https://naverapihub.apigw.ntruss.com/search/v1/local';
const TIMEOUT_MS = 8000;
const MAX_QUERY = 60;
const NO_SERVER = '장소 검색 서버가 응답하지 않아요';

export interface Place {
  name: string;
  category: string;
  address: string;
  lat: number;
  lon: number;
}

interface NaverItem {
  title?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  mapx?: string | number;
  mapy?: string | number;
}

/** 네이버 글의 굵게(<b>) 표시와 HTML 기호를 걷어 낸다 */
const plain = (s: unknown): string =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

/** mapx·mapy: WGS84 도 × 10⁷ 정수 (예 1288994813 → 128.8994813). 소수로 오면 그대로 */
const degrees = (v: unknown): number => {
  const n = Number(v);
  return Math.abs(n) > 1000 ? n / 1e7 : n;
};

export async function searchPlaces(env: Cloudflare.Env, userId: string, q: string | null, now = Date.now()): Promise<Place[]> {
  const query = (q ?? '').trim();
  if (!query) throw new HttpError(400, '찾을 장소 이름을 적어 주세요');
  if (query.length > MAX_QUERY) throw new HttpError(400, '검색어가 너무 길어요');
  const id = env.NAVER_CLIENT_ID;
  const secret = env.NAVER_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(503, '장소 검색을 쓸 수 없어요');
  await countUsage(env, 'search_usage', userId, now, SEARCH_LIMIT_PER_DAY, '오늘 장소 검색을 너무 많이 했어요. 내일 다시 해 주세요');

  const u = new URL(NAVER_LOCAL);
  u.searchParams.set('query', query);
  u.searchParams.set('display', '5');
  let r: Response;
  try {
    r = await fetch(u.href, { headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, NO_SERVER);
  }
  if (!r.ok) throw new HttpError(502, NO_SERVER);
  let items: NaverItem[];
  try {
    items = ((await r.json()) as { items?: NaverItem[] }).items ?? [];
  } catch {
    throw new HttpError(502, NO_SERVER);
  }
  const out: Place[] = [];
  for (const it of items) {
    const lat = degrees(it.mapy);
    const lon = degrees(it.mapx);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inKorea(lat, lon)) continue;
    out.push({ name: plain(it.title), category: plain(it.category), address: plain(it.roadAddress) || plain(it.address), lat, lon });
  }
  return out;
}
