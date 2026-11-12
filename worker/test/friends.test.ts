// 친구 위치 공유 서버 테스트 (사양서 6.5, M8): 실제 Workers 런타임, D1은 메모리
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/index';
import { CODE_MISSES_PER_HOUR, normalizeCode, PRESENCE_FRESH_MS, putPresence } from '../src/friends';

const ORIGIN = 'https://example.github.io';
let ipSeq = 0;
function call(method: string, path: string, init: { token?: string; body?: object } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, 'CF-Connecting-IP': `10.9.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}` };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body) headers['Content-Type'] = 'application/json';
  return handle(new Request(`https://api.example.workers.dev${path}`, { method, headers, body: init.body ? JSON.stringify(init.body) : undefined }), env);
}
async function user(nickname: string) {
  const r = await call('POST', '/auth/signup', { body: { nickname } });
  return (await r.json()) as { userId: string; token: string };
}
async function friendsOf(token: string) {
  const r = await call('GET', '/api/friends', { token });
  expect(r.status).toBe(200);
  return (await r.json()) as { code: string; friends: Array<{ userId: string; nickname: string; sharing: boolean }> };
}

describe('친구 코드와 친구 맺기', () => {
  it('친구 코드는 8자리(헷갈리는 글자 없음)이고, 다시 열어도 같다', async () => {
    const a = await user('민수');
    const { code, friends } = await friendsOf(a.token);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect(friends).toEqual([]);
    expect((await friendsOf(a.token)).code).toBe(code);
    expect(normalizeCode(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `)).toBe(code);
    expect(normalizeCode('ABCD-EF0O')).toBeNull();
  });

  it('코드를 넣으면 바로 서로 친구, 끊으면 양쪽 모두 끊긴다', async () => {
    const a = await user('민수');
    const b = await user('지훈');
    const codeB = (await friendsOf(b.token)).code;
    const r = await call('POST', '/api/friends', { token: a.token, body: { code: `${codeB.slice(0, 4)}-${codeB.slice(4)}` } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ userId: b.userId, nickname: '지훈', already: false });
    expect((await friendsOf(a.token)).friends.map((f) => f.nickname)).toEqual(['지훈']);
    expect((await friendsOf(b.token)).friends.map((f) => f.nickname)).toEqual(['민수']);
    // 같은 코드를 또 넣어도 한 번만
    expect(await (await call('POST', '/api/friends', { token: a.token, body: { code: codeB } })).json()).toMatchObject({ already: true });
    expect((await friendsOf(a.token)).friends.length).toBe(1);
    expect((await call('DELETE', `/api/friends/${a.userId}`, { token: b.token })).status).toBe(200);
    expect((await friendsOf(a.token)).friends).toEqual([]);
    expect((await friendsOf(b.token)).friends).toEqual([]);
  });

  it('내 코드·모양이 틀린 코드는 400, 없는 코드는 404, 틀린 코드는 1시간에 20번까지 (짐작 방지)', async () => {
    const a = await user('민수');
    const own = (await friendsOf(a.token)).code;
    expect((await call('POST', '/api/friends', { token: a.token, body: { code: own } })).status).toBe(400);
    expect((await call('POST', '/api/friends', { token: a.token, body: { code: '123' } })).status).toBe(400);
    const missing = own === '22222222' ? '33333333' : '22222222';
    for (let i = 0; i < CODE_MISSES_PER_HOUR; i++) expect((await call('POST', '/api/friends', { token: a.token, body: { code: missing } })).status).toBe(404);
    expect((await call('POST', '/api/friends', { token: a.token, body: { code: missing } })).status).toBe(429);
    // 다른 사람은 막히지 않는다
    const b = await user('지훈');
    expect((await call('POST', '/api/friends', { token: b.token, body: { code: missing } })).status).toBe(404);
  });

  it('열쇠 없이는 401, 브라우저에서 DELETE를 허용한다(CORS)', async () => {
    expect((await call('GET', '/api/friends')).status).toBe(401);
    const pre = await handle(new Request('https://api.example.workers.dev/api/presence', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'DELETE' } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });
});

describe('위치 공유 (본인이 켠 동안만, 마지막 위치 하나만)', () => {
  it('친구에게만 보이고, 2분이 지나거나 공유를 끄면 보이지 않는다', async () => {
    const a = await user('민수');
    const b = await user('지훈');
    const c = await user('남');
    await call('POST', '/api/friends', { token: a.token, body: { code: (await friendsOf(b.token)).code } });
    expect((await call('PUT', '/api/presence', { token: b.token, body: { lat: 37.5665, lon: 126.978, hAcc: 6, heading: 90, speed: 12.3 } })).status).toBe(200);
    const seen = (await (await call('GET', '/api/friends/presence', { token: a.token })).json()) as Array<Record<string, unknown>>;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ userId: b.userId, nickname: '지훈', lat: 37.5665, lon: 126.978, hAcc: 6, heading: 90, speed: 12.3 });
    expect((await friendsOf(a.token)).friends[0]!.sharing).toBe(true);
    // 친구가 아니면 안 보인다
    expect(await (await call('GET', '/api/friends/presence', { token: c.token })).json()).toEqual([]);
    // 같은 사람은 행 하나 (덮어씀)
    await call('PUT', '/api/presence', { token: b.token, body: { lat: 37.567, lon: 126.979 } });
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM presence WHERE user_id = ?').bind(b.userId).first<{ n: number }>();
    expect(rows?.n).toBe(1);
    // 2분 넘은 위치는 안 보인다
    await putPresence(env, b.userId, { lat: 37.5, lon: 127 }, Date.now() - PRESENCE_FRESH_MS - 1000);
    expect(await (await call('GET', '/api/friends/presence', { token: a.token })).json()).toEqual([]);
    expect((await friendsOf(a.token)).friends[0]!.sharing).toBe(false);
    // 공유 끄기 = 지움
    await call('PUT', '/api/presence', { token: b.token, body: { lat: 37.567, lon: 126.979 } });
    expect((await call('DELETE', '/api/presence', { token: b.token })).status).toBe(200);
    expect(await (await call('GET', '/api/friends/presence', { token: a.token })).json()).toEqual([]);
  });

  it('위치 값이 틀리면 400', async () => {
    const a = await user('민수');
    expect((await call('PUT', '/api/presence', { token: a.token, body: { lat: 91, lon: 0 } })).status).toBe(400);
    expect((await call('PUT', '/api/presence', { token: a.token, body: { lat: 37, lon: 'x' } })).status).toBe(400);
    expect((await call('PUT', '/api/presence', { token: a.token, body: { lat: 37, lon: 127, speed: -1 } })).status).toBe(400);
  });
});
