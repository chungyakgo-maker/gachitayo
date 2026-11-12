// 앞 친구 간격용 실시간 방 테스트 (M9): 실제 Workers 런타임의 Durable Object와 WebSocket
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/index';
import { parseLivePoint } from '../src/live';

const ORIGIN = 'https://example.github.io';
let ip = 0;
async function call(method: string, path: string, init: { token?: string; body?: object } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, 'CF-Connecting-IP': `10.8.${Math.floor(++ip / 200)}.${ip % 200}` };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body) headers['Content-Type'] = 'application/json';
  return handle(new Request(`https://api.example.workers.dev${path}`, { method, headers, body: init.body ? JSON.stringify(init.body) : undefined }), env);
}
async function user(nickname: string) {
  return (await (await call('POST', '/auth/signup', { body: { nickname } })).json()) as { userId: string; token: string };
}
async function befriend(a: { token: string }, b: { token: string }) {
  const code = ((await (await call('GET', '/api/friends', { token: b.token })).json()) as { code: string }).code;
  expect((await call('POST', '/api/friends', { token: a.token, body: { code } })).status).toBe(200);
}
function connect(room: string, token: string | null) {
  const headers: Record<string, string> = { Origin: ORIGIN, Upgrade: 'websocket' };
  if (token) headers['Sec-WebSocket-Protocol'] = `gachitayo, ${token}`;
  return handle(new Request(`https://api.example.workers.dev/live/${room}`, { headers }), env);
}
function open(res: Response) {
  expect(res.status).toBe(101);
  expect(res.headers.get('Sec-WebSocket-Protocol')).toBe('gachitayo');
  const ws = res.webSocket!;
  const got: string[] = [];
  ws.accept();
  ws.addEventListener('message', (e) => got.push(e.data as string));
  return { ws, got };
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('실시간 방 (앞 친구 간격, M9)', () => {
  it('앞 친구가 자기 방에 보낸 위치를 친구가 받는다. 새로 붙은 친구는 마지막 위치를 바로 받는다', async () => {
    const lead = await user('앞차');
    const follow = await user('뒤차');
    await befriend(follow, lead);
    const L = open(await connect(lead.userId, lead.token));
    const F = open(await connect(lead.userId, follow.token));
    const p = { t: 1_800_000_000_000, lat: 37.5, lon: 127.0, speed: 20.5, heading: 90, hAcc: 4 };
    L.ws.send(JSON.stringify({ ...p, extra: '<script>' }));
    await until(() => F.got.length > 0);
    expect(JSON.parse(F.got[0]!)).toEqual(p); // 정해진 모양만 전한다
    // 뒤차가 보낸 것은 무시
    F.ws.send(JSON.stringify({ ...p, lat: 1 }));
    // 나중에 붙은 친구
    const F2 = open(await connect(lead.userId, follow.token));
    await until(() => F2.got.length > 0);
    expect(JSON.parse(F2.got[0]!).lat).toBe(37.5);
    expect(L.got).toEqual([]);
    L.ws.close();
    F.ws.close();
    F2.ws.close();
  });

  it('친구가 아니면 403, 열쇠가 없으면 401, WebSocket이 아니면 426', async () => {
    const a = await user('가');
    const b = await user('나');
    expect((await connect(a.userId, b.token)).status).toBe(403);
    expect((await connect(a.userId, null)).status).toBe(401);
    const plain = await handle(new Request(`https://api.example.workers.dev/live/${a.userId}`, { headers: { Origin: ORIGIN } }), env);
    expect(plain.status).toBe(426);
  });

  it('위치 모양이 틀리면 전하지 않는다', () => {
    expect(parseLivePoint('{"t":1800000000000,"lat":91,"lon":0}')).toBeNull();
    expect(parseLivePoint('not json')).toBeNull();
    expect(parseLivePoint('x'.repeat(600))).toBeNull();
    expect(parseLivePoint('{"t":1800000000000,"lat":37,"lon":127,"speed":-3}')).toEqual({ t: 1800000000000, lat: 37, lon: 127, speed: null, heading: null, hAcc: null });
  });
});
