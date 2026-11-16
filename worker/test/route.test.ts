// 목적지 길찾기 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.1): 카카오모빌리티 길찾기를 대신 부르고 하루 한도를 센다
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../src/index';
import { ROUTE_LIMIT_PER_DAY } from '../src/route';

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

// ── 카카오 흉내 ─────────────────────────────────────────
let kakao: { status: number; body: unknown } = { status: 200, body: {} };
const calls: Array<{ url: URL; auth: string | null }> = [];
const okBody = {
  trans_id: 't',
  routes: [
    {
      result_code: 0,
      result_msg: '길찾기 성공',
      summary: { distance: 230, duration: 41 },
      sections: [
        {
          roads: [
            { name: '', distance: 88, vertexes: [127, 37.5, 127.001, 37.5] },
            { name: '남산공원길', distance: 142, vertexes: [127.001, 37.5, 127.002, 37.501] },
          ],
        },
      ],
    },
  ],
};
beforeEach(() => {
  calls.length = 0;
  kakao = { status: 200, body: okBody };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin + url.pathname !== 'https://apis-navi.kakaomobility.com/v1/directions') throw new Error(`예상하지 못한 호출 ${url}`);
    calls.push({ url, auth: new Headers(init?.headers).get('Authorization') });
    return Response.json(kakao.body, { status: kakao.status });
  });
});
afterEach(() => vi.restoreAllMocks());

const kstDay = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

describe('목적지 길찾기 /api/route', () => {
  it('returns flattened points and dest name', async () => {
    const u = await newUser();
    const r = await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO } });
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
  });

  it('passes heading as angle', async () => {
    const u = await newUser();
    await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO, headingDeg: 91.6 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get('origin')).toBe('127,37.5,angle=92');
    expect(calls[0]!.url.searchParams.get('destination')).toBe('127.002,37.501');
    expect(calls[0]!.auth).toBe('KakaoAK test-rest-key');
  });

  it('kakao result code becomes 404 with its message', async () => {
    const u = await newUser();
    const msg = '출발지와 도착지가 5 m 이내로 설정된 경우 경로를 탐색할 수 없음';
    kakao = { status: 200, body: { trans_id: 't', routes: [{ result_code: 104, result_msg: msg }] } };
    const r = await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO } });
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: string }).error).toBe(msg);
  });

  it('kakao http failure becomes 502', async () => {
    const u = await newUser();
    kakao = { status: 401, body: { code: -401, msg: 'unauthorized' } };
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
    expect(((await r.json()) as { error: string }).error).toBe('오늘 길찾기를 너무 많이 했어요. 내일 다시 해 주세요');
    expect(calls).toHaveLength(0);
  });

  it('counts each request', async () => {
    const u = await newUser();
    await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO } });
    await call('POST', '/api/route', { token: u.token, body: { from: FROM, to: TO } });
    const row = await env.DB.prepare('SELECT count FROM route_usage WHERE user_id = ? AND day = ?').bind(u.userId, kstDay()).first<{ count: number }>();
    expect(row?.count).toBe(2);
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
