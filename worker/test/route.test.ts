// 목적지 길찾기·장소 검색 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.1, 6):
// 네이버 클라우드 길찾기(Maps Directions 15)와 지역 검색(NAVER API HUB)을 대신 부르고 하루 한도를 센다
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../src/index';
import { ROUTE_LIMIT_PER_DAY } from '../src/route';
import { SEARCH_LIMIT_PER_DAY } from '../src/places';

const ORIGIN = 'https://example.github.io';
const BASE = 'https://api.example.workers.dev';
let ipSeq = 0;

function call(method: string, path: string, init: { token?: string; body?: object } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, 'CF-Connecting-IP': `10.7.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body) headers['Content-Type'] = 'application/json';
  return handle(new Request(`${BASE}${path}`, { method, headers, body: init.body ? JSON.stringify(init.body) : undefined }), env);
}

async function newUser() {
  const r = await call('POST', '/auth/signup', { body: { nickname: '민수' } });
  expect(r.status).toBe(201);
  return (await r.json()) as { userId: string; token: string };
}

const FROM = { lat: 37.5, lon: 127 };
const TO = { lat: 37.501, lon: 127.002 };
const kstDay = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

// ── 네이버 흉내 ─────────────────────────────────────────
const DIRECTIONS = 'https://maps.apigw.ntruss.com/map-direction-15/v1/driving';
const LOCAL = 'https://naverapihub.apigw.ntruss.com/search/v1/local';
let directions: { status: number; body: unknown } = { status: 200, body: {} };
let local: { status: number; body: unknown } = { status: 200, body: {} };
const calls: Array<{ url: URL; id: string | null; key: string | null }> = [];
const okRoute = {
  code: 0,
  message: '길찾기를 성공하였습니다.',
  route: {
    traoptimal: [
      {
        summary: { distance: 230, duration: 41_400 },
        path: [
          [127, 37.5],
          [127.001, 37.5],
          [127.001, 37.5],
          [127.002, 37.501],
        ],
        section: [
          { name: '', distance: 88 },
          { name: '남산공원길', distance: 142 },
        ],
      },
    ],
  },
};
const okLocal = {
  total: 2,
  items: [
    { title: '<b>만항재</b>', category: '고개,골짜기', address: '강원특별자치도 정선군 고한읍 고한리 산216-37', roadAddress: '', mapx: '1288994813', mapy: '371487091' },
    { title: '<b>만항재</b>쉼터 &amp; 매점', category: '음식점>한식', address: '강원특별자치도 정선군 고한읍 고한리', roadAddress: '강원특별자치도 정선군 고한읍 함백산로 865', mapx: '1288990109', mapy: '371485900' },
  ],
};
beforeEach(() => {
  calls.length = 0;
  directions = { status: 200, body: okRoute };
  local = { status: 200, body: okLocal };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const h = new Headers(init?.headers);
    calls.push({ url, id: h.get('X-NCP-APIGW-API-KEY-ID'), key: h.get('X-NCP-APIGW-API-KEY') });
    const base = url.origin + url.pathname;
    if (base === DIRECTIONS) return Response.json(directions.body, { status: directions.status });
    if (base === LOCAL) return Response.json(local.body, { status: local.status });
    throw new Error(`예상하지 못한 호출 ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('목적지 길찾기 /api/route (네이버)', () => {
  it('returns points, seconds and the last road name', async () => {
    const u = await newUser();
    const r = await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO, headingDeg: 90 } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      distanceM: 230,
      durationS: 41,
      points: [
        [37.5, 127],
        [37.5, 127.001],
        [37.501, 127.002],
      ],
      destName: '남산공원길',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get('start')).toBe('127,37.5');
    expect(calls[0]!.url.searchParams.get('goal')).toBe('127.002,37.501');
    expect(calls[0]!.id).toBe('test-map-id');
    expect(calls[0]!.key).toBe('test-map-secret');
  });

  it('naver result code becomes 404 with its message', async () => {
    const u = await newUser();
    directions = { status: 200, body: { code: 2, message: '출발지 또는 도착지가 도로 주변이 아닌 경우' } };
    const r = await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO } });
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: string }).error).toBe('출발지 또는 도착지가 도로 주변이 아닌 경우');
  });

  it('naver http failure becomes 502', async () => {
    const u = await newUser();
    directions = { status: 401, body: { error: { errorCode: '210', message: 'Permission Denied' } } };
    const r = await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO } });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toBe('길찾기 서버가 응답하지 않아요');
  });

  it('outside korea is 400', async () => {
    const u = await newUser();
    const r = await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: { lat: 10, lon: 10 } } });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('한국 안에서만 길찾기가 돼요');
    expect(calls).toHaveLength(0);
  });

  it('daily limit 429', async () => {
    const u = await newUser();
    await env.DB.prepare('INSERT INTO route_usage (user_id, day, count) VALUES (?, ?, ?)').bind(u.userId, kstDay(), ROUTE_LIMIT_PER_DAY).run();
    const r = await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO } });
    expect(r.status).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it('needs account', async () => {
    const r = await call('POST', '/api/route', { body: { from: FROM, to: TO } });
    expect(r.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('bad body is 400', async () => {
    const u = await newUser();
    const r = await call('POST', '/api/route', { token: u.token, body: { from: FROM } });
    expect(r.status).toBe(400);
  });
});

describe('바이크 길찾기 (2026-11-18 바이크 모드: 고속도로·자동차전용도로 피함)', () => {
  const R = (lon: number, roads: string[], distance: number) => ({
    summary: { distance, duration: distance * 100 },
    path: [
      [127, 37.5],
      [lon, 37.501],
    ],
    section: roads.map((name) => ({ name, distance: 10 })),
  });
  const naver = (route: Record<string, unknown[]>) => ({ status: 200, body: { code: 0, message: 'ok', route } });

  it('자동차 전용 도로 회피·무료 우선·편한 길 세 옵션을 한 번에 묻고, 전용 도로 없는 경로를 고른다', async () => {
    const u = await newUser();
    directions = naver({
      traavoidcaronly: [R(127.003, ['북악산로', '내부순환로'], 5000)],
      traavoidtoll: [R(127.004, ['북악산로', '평창문화로'], 6000)],
      tracomfort: [R(127.005, ['경부고속도로'], 7000)],
    });
    const r = await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO, vehicle: 'bike' } });
    expect(r.status).toBe(200);
    const j = (await r.json()) as Record<string, unknown>;
    expect(calls[0]!.url.searchParams.get('option')).toBe('traavoidcaronly:traavoidtoll:tracomfort');
    expect(j).toMatchObject({ distanceM: 6000, vehicle: 'bike', warnRoads: [], alt: 0, alts: 3, destName: '평창문화로' });
  });

  it('모두 섞였으면 회피 우선 경로 + 섞인 도로 이름, alt로 다음 후보 (같은 경로는 한 번만)', async () => {
    const u = await newUser();
    directions = naver({
      traavoidcaronly: [R(127.003, ['북악산로', '내부순환로', '내부순환로'], 5000)],
      traavoidtoll: [R(127.003, ['북악산로', '내부순환로'], 5000)],
      tracomfort: [R(127.005, ['올림픽대로', '서울양양고속도로'], 7000)],
    });
    const first = (await (await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO, vehicle: 'bike' } })).json()) as Record<string, unknown>;
    expect(first).toMatchObject({ distanceM: 5000, warnRoads: ['내부순환로'], alt: 0, alts: 2 });
    const next = (await (await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO, vehicle: 'bike', alt: 1 } })).json()) as Record<string, unknown>;
    expect(next).toMatchObject({ distanceM: 7000, warnRoads: ['올림픽대로', '서울양양고속도로'], alt: 1, alts: 2 });
    const wrap = (await (await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO, vehicle: 'bike', alt: 2 } })).json()) as Record<string, unknown>;
    expect(wrap).toMatchObject({ distanceM: 5000, alt: 0 });
  });

  it('자동차는 옵션 없이 예전과 같은 응답 (바이크 칸 없음)', async () => {
    const u = await newUser();
    const r = await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO, vehicle: 'car' } });
    expect(calls[0]!.url.searchParams.get('option')).toBeNull();
    expect(Object.keys((await r.json()) as object).sort()).toEqual(['destName', 'distanceM', 'durationS', 'points']);
  });

  it('도로 이름으로 자동차 전용 도로를 알아본다', async () => {
    const { isCarOnlyRoad } = await import('../src/route');
    for (const n of ['경부고속도로', '수도권제1순환고속도로', '제3경인고속화도로', '올림픽대로', '강변북로', '자유로', '동부간선도로']) expect(isCarOnlyRoad(n)).toBe(true);
    for (const n of ['북악산로', '남산공원길', '자유로운길', '번영로', '국도44호선', '']) expect(isCarOnlyRoad(n)).toBe(false);
  });
});

describe('장소 검색 /api/places (네이버 지역 검색)', () => {
  it('finds places by name with coordinates', async () => {
    const u = await newUser();
    const r = await call('GET', `/api/places?q=${encodeURIComponent('만항재')}`, { token: u.token });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([
      { name: '만항재', category: '고개,골짜기', address: '강원특별자치도 정선군 고한읍 고한리 산216-37', lat: 37.1487091, lon: 128.8994813 },
      { name: '만항재쉼터 & 매점', category: '음식점>한식', address: '강원특별자치도 정선군 고한읍 함백산로 865', lat: 37.14859, lon: 128.8990109 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get('query')).toBe('만항재');
    expect(calls[0]!.url.searchParams.get('display')).toBe('5');
    expect(calls[0]!.id).toBe('test-search-id');
    expect(calls[0]!.key).toBe('test-search-secret');
  });

  it('empty query is 400', async () => {
    const u = await newUser();
    const r = await call('GET', '/api/places?q=%20', { token: u.token });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('찾을 장소 이름을 적어 주세요');
    expect(calls).toHaveLength(0);
  });

  it('naver failure becomes 502', async () => {
    const u = await newUser();
    local = { status: 401, body: { errorMessage: 'Authentication failed' } };
    const r = await call('GET', `/api/places?q=${encodeURIComponent('만항재')}`, { token: u.token });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toBe('장소 검색 서버가 응답하지 않아요');
  });

  it('daily search limit 429', async () => {
    const u = await newUser();
    await env.DB.prepare('INSERT INTO search_usage (user_id, day, count) VALUES (?, ?, ?)').bind(u.userId, kstDay(), SEARCH_LIMIT_PER_DAY).run();
    const r = await call('GET', `/api/places?q=${encodeURIComponent('만항재')}`, { token: u.token });
    expect(r.status).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it('needs account', async () => {
    const r = await call('GET', `/api/places?q=${encodeURIComponent('만항재')}`);
    expect(r.status).toBe(401);
  });
});
