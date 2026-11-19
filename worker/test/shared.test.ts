// 모두의 코스 (설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md 2부, 시안 ⑥⑦⑧):
// 공개는 카카오·애플 로그인 계정만, 보기·받기는 누구나. 기록은 올라가지 않는다
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/index';

const ORIGIN = 'https://example.github.io';
const BASE = 'https://api.example.workers.dev';
let ipSeq = 0;
function call(method: string, path: string, init: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, 'CF-Connecting-IP': `10.7.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return handle(new Request(`${BASE}${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), env);
}
async function newUser(nickname = '민수') {
  const r = await call('POST', '/auth/signup', { body: { nickname } });
  expect(r.status).toBe(201);
  return (await r.json()) as { userId: string; token: string };
}
async function signedIn(nickname = '바람') {
  const u = await newUser(nickname);
  await env.DB.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('kakao', ?, ?, ?)").bind(`k-${u.userId}`, u.userId, new Date().toISOString()).run();
  return u;
}
const gate = (lat: number) => ({ lat, lon: 127.5, bearingDeg: 0, widthM: 30 });
const line = (n: number, from = 37.5): Array<[number, number]> => Array.from({ length: n }, (_, i) => [from + i * 0.0001, 127.5] as [number, number]);
export const body = (p: Record<string, unknown> = {}) => ({
  name: '유명산 업힐',
  region: '경기',
  kind: 'point_to_point',
  lengthM: 7800,
  startGate: gate(37.5),
  finishGate: gate(37.57),
  sectorBoundsM: [2600, 5200],
  line: line(100),
  thumb: line(10),
  ...p,
});
type Summary = { id: string; name: string; region: string; kind: string; lengthM: number; start: { lat: number; lon: number }; thumb: unknown; adds: number; by: string; byId: string; createdAt: number; mine: boolean };
async function publish(u: { token: string }, p: Record<string, unknown> = {}) {
  const r = await call('POST', '/api/shared', { token: u.token, body: body(p) });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}
async function list(u: { token: string }): Promise<Summary[]> {
  const out: Summary[] = [];
  let after: string | null = '';
  while (after !== null) {
    const r = await call('GET', `/api/shared${after ? `?after=${encodeURIComponent(after)}` : ''}`, { token: u.token });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { items: Summary[]; next: string | null };
    out.push(...j.items);
    after = j.next;
  }
  return out;
}

describe('모두의 코스: 공개 · 목록 · 상세', () => {
  it('로그인 안 한 계정은 공개 403 (문구)', async () => {
    const u = await newUser();
    const r = await call('POST', '/api/shared', { token: u.token, body: body() });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe('공개하려면 카카오나 Apple로 로그인해 주세요');
  });

  it('로그인한 계정은 공개 201, 목록·상세에 보인다 (by = 닉네임, mine)', async () => {
    const a = await signedIn('바람');
    const b = await newUser('민수');
    const id = await publish(a, { name: `업힐-${crypto.randomUUID().slice(0, 6)}` });
    const seen = (await list(b)).find((x) => x.id === id)!;
    expect(seen).toMatchObject({ region: '경기', kind: 'point_to_point', lengthM: 7800, start: { lat: 37.5, lon: 127.5 }, adds: 0, by: '바람', byId: a.userId, mine: false });
    expect((await list(a)).find((x) => x.id === id)!.mine).toBe(true);
    const d = (await (await call('GET', `/api/shared/${id}`, { token: b.token })).json()) as Record<string, unknown>;
    expect(d).toMatchObject({ id, status: 'open', startGate: gate(37.5), finishGate: gate(37.57), sectorBoundsM: [2600, 5200] });
    expect((d.line as unknown[]).length).toBe(100);
  });

  it('이름 나쁜 말·길이·점 수·지역을 검사한다 (400)', async () => {
    const a = await signedIn();
    const bad = async (p: Record<string, unknown>) => (await call('POST', '/api/shared', { token: a.token, body: body(p) })).status;
    const r = await call('POST', '/api/shared', { token: a.token, body: body({ name: '씨발 코스' }) });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('이름에 쓸 수 없는 말이 있어요');
    expect(await bad({ name: '' })).toBe(400);
    expect(await bad({ name: 'x'.repeat(41) })).toBe(400);
    expect(await bad({ lengthM: 299 })).toBe(400);
    expect(await bad({ lengthM: 100_100 })).toBe(400);
    expect(await bad({ line: line(1) })).toBe(400);
    expect(await bad({ line: line(5001) })).toBe(400);
    expect(await bad({ thumb: line(41) })).toBe(400);
    expect(await bad({ region: '평양' })).toBe(400);
    expect(await bad({ kind: 'circle' })).toBe(400);
    expect(await bad({ startGate: { lat: 99, lon: 127, bearingDeg: 0, widthM: 30 } })).toBe(400);
    expect((await call('POST', '/api/shared', { token: a.token, body: body({ region: '' }) })).status).toBe(201);
  });

  it('계정당 20개까지 (21번째 400)', async () => {
    const a = await signedIn();
    for (let i = 0; i < 20; i++) await publish(a, { name: `코스 ${i}` });
    const r = await call('POST', '/api/shared', { token: a.token, body: body() });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('공개는 20개까지예요');
  });

  it('고치기·내리기는 올린 사람만 (남은 403), 내리면 목록·상세에서 사라진다', async () => {
    const a = await signedIn();
    const b = await signedIn();
    const id = await publish(a);
    expect((await call('PUT', `/api/shared/${id}`, { token: b.token, body: body({ name: '남이 고침' }) })).status).toBe(403);
    expect((await call('PUT', `/api/shared/${id}`, { token: a.token, body: body({ name: '고친 이름' }) })).status).toBe(200);
    expect(((await (await call('GET', `/api/shared/${id}`, { token: b.token })).json()) as { name: string }).name).toBe('고친 이름');
    expect((await call('DELETE', `/api/shared/${id}`, { token: b.token })).status).toBe(403);
    expect((await call('DELETE', `/api/shared/${id}`, { token: a.token })).status).toBe(200);
    expect((await list(b)).some((x) => x.id === id)).toBe(false);
    expect((await call('GET', `/api/shared/${id}`, { token: b.token })).status).toBe(404);
  });

  it('받기는 한 사람 한 번 (adds 는 계정 수)', async () => {
    const a = await signedIn();
    const b = await newUser();
    const c = await newUser();
    const id = await publish(a);
    expect(await (await call('POST', `/api/shared/${id}/add`, { token: b.token })).json()).toEqual({ adds: 1 });
    expect(await (await call('POST', `/api/shared/${id}/add`, { token: b.token })).json()).toEqual({ adds: 1 });
    expect(await (await call('POST', `/api/shared/${id}/add`, { token: c.token })).json()).toEqual({ adds: 2 });
    expect((await call('POST', `/api/shared/nope/add`, { token: c.token })).status).toBe(404);
  });

  it('목록은 300개씩, next 로 다음 쪽 (새것부터)', async () => {
    const owners = await Promise.all(Array.from({ length: 16 }, () => signedIn()));
    const ids: string[] = [];
    for (const o of owners) for (let i = 0; i < 20; i++) ids.push(await publish(o, { name: `쪽 ${i}` }));
    const me = await newUser();
    const first = (await (await call('GET', '/api/shared', { token: me.token })).json()) as { items: Summary[]; next: string | null };
    expect(first.items.length).toBe(300);
    expect(first.next).not.toBeNull();
    expect(first.items[0]!.createdAt).toBeGreaterThanOrEqual(first.items[299]!.createdAt);
    const all = await list(me);
    for (const id of ids) expect(all.some((x) => x.id === id)).toBe(true);
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
  }, 60_000);
});
