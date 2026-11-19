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

const report = (u: { token: string }, id: string, reason = 'danger') => call('POST', `/api/shared/${id}/report`, { token: u.token, body: { reason } });
function asAdmin(u: { userId: string }) {
  (env as { ADMIN_USER_IDS?: string }).ADMIN_USER_IDS = u.userId;
}

describe('모두의 코스: 신고 · 자동 숨김 (애플 심사 1.2)', () => {
  it('신고는 로그인 계정만, 한 사람 한 번, 자기 코스는 400', async () => {
    const a = await signedIn();
    const id = await publish(a);
    const anon = await newUser();
    const r = await report(anon, id);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe('신고하려면 카카오나 Apple로 로그인해 주세요');
    expect((await report(a, id)).status).toBe(400);
    const b = await signedIn();
    expect((await report(b, id)).status).toBe(200);
    expect((await report(b, id, 'name')).status).toBe(200);
    const row = await env.DB.prepare('SELECT reports, status FROM public_courses WHERE id = ?').bind(id).first<{ reports: number; status: string }>();
    expect(row).toEqual({ reports: 1, status: 'open' });
    expect((await call('POST', `/api/shared/${id}/report`, { token: b.token, body: { reason: 'spam' } })).status).toBe(400);
  });

  it('서로 다른 3명이 신고하면 숨김: 남에겐 목록·상세 404, 올린 사람·관리자는 상세에서 hidden', async () => {
    const a = await signedIn();
    const id = await publish(a);
    for (let i = 0; i < 3; i++) expect((await report(await signedIn(), id)).status).toBe(200);
    const viewer = await newUser();
    expect((await list(viewer)).some((x) => x.id === id)).toBe(false);
    expect((await call('GET', `/api/shared/${id}`, { token: viewer.token })).status).toBe(404);
    expect(((await (await call('GET', `/api/shared/${id}`, { token: a.token })).json()) as { status: string }).status).toBe('hidden');
    const admin = await newUser();
    asAdmin(admin);
    expect(((await (await call('GET', `/api/shared/${id}`, { token: admin.token })).json()) as { status: string }).status).toBe('hidden');
  });
});

describe('모두의 코스: 이 사람 코스 안 보기', () => {
  it('차단하면 그 사람 코스가 목록에서 빠지고, 풀면 돌아온다. 목록에 닉네임', async () => {
    const a = await signedIn('나쁜사람');
    const id = await publish(a);
    const me = await newUser();
    expect((await call('POST', '/api/blocks', { token: me.token, body: { userId: a.userId } })).status).toBe(200);
    expect((await list(me)).some((x) => x.id === id)).toBe(false);
    expect(await (await call('GET', '/api/blocks', { token: me.token })).json()).toEqual([{ userId: a.userId, nickname: '나쁜사람' }]);
    expect((await call('DELETE', `/api/blocks/${a.userId}`, { token: me.token })).status).toBe(200);
    expect((await list(me)).some((x) => x.id === id)).toBe(true);
    expect((await call('POST', '/api/blocks', { token: me.token, body: { userId: me.userId } })).status).toBe(400);
  });
});

describe('모두의 코스: 관리자', () => {
  it('관리자 아니면 /api/admin/* 403, /api/me 의 admin', async () => {
    const u = await newUser();
    (env as { ADMIN_USER_IDS?: string }).ADMIN_USER_IDS = '';
    expect((await call('GET', '/api/admin/shared', { token: u.token })).status).toBe(403);
    expect(((await (await call('GET', '/api/me', { token: u.token })).json()) as { admin: boolean }).admin).toBe(false);
    asAdmin(u);
    expect(((await (await call('GET', '/api/me', { token: u.token })).json()) as { admin: boolean }).admin).toBe(true);
  });

  it('관리자 목록은 숨김·신고 있는 것 먼저, 이유 수; 숨기기·풀기·지우기', async () => {
    const a = await signedIn();
    const quiet = await publish(a, { name: '조용한 코스' });
    const reported = await publish(a, { name: '신고된 코스' });
    await report(await signedIn(), reported, 'name');
    const admin = await newUser();
    asAdmin(admin);
    const rows = (await (await call('GET', '/api/admin/shared', { token: admin.token })).json()) as Array<{ id: string; status: string; reports: number; reasons: Record<string, number> }>;
    const iR = rows.findIndex((r) => r.id === reported);
    const iQ = rows.findIndex((r) => r.id === quiet);
    expect(iR).toBeGreaterThanOrEqual(0);
    expect(iR).toBeLessThan(iQ);
    expect(rows[iR]).toMatchObject({ reports: 1, reasons: { name: 1 } });
    expect((await call('POST', `/api/admin/shared/${quiet}`, { token: admin.token, body: { action: 'hide' } })).status).toBe(200);
    expect((await call('GET', `/api/shared/${quiet}`, { token: (await newUser()).token })).status).toBe(404);
    expect((await call('POST', `/api/admin/shared/${quiet}`, { token: admin.token, body: { action: 'show' } })).status).toBe(200);
    expect((await call('GET', `/api/shared/${quiet}`, { token: (await newUser()).token })).status).toBe(200);
    expect((await call('DELETE', `/api/shared/${quiet}`, { token: admin.token })).status).toBe(200);
    expect((await call('GET', `/api/shared/${quiet}`, { token: a.token })).status).toBe(404);
  });

  it('공개 막기: 그 계정 코스 모두 숨김 + 새 공개 403, 풀면 공개할 수 있다', async () => {
    const a = await signedIn();
    const id = await publish(a);
    const admin = await newUser();
    asAdmin(admin);
    expect((await call('POST', '/api/admin/bans', { token: admin.token, body: { userId: a.userId } })).status).toBe(200);
    expect((await call('GET', `/api/shared/${id}`, { token: (await newUser()).token })).status).toBe(404);
    const r = await call('POST', '/api/shared', { token: a.token, body: body() });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe('이 계정은 코스를 공개할 수 없어요');
    expect((await call('DELETE', `/api/admin/bans/${a.userId}`, { token: admin.token })).status).toBe(200);
    expect((await call('POST', '/api/shared', { token: a.token, body: body() })).status).toBe(201);
  });
});

describe('계정 지우기 정리 (모두의 코스 + 인기 신호)', () => {
  it('공개 코스·받기·신고·차단(양쪽)·공개 막기·주행 신호 줄이 모두 지워진다', async () => {
    const a = await signedIn();
    const b = await signedIn();
    const mine = await publish(a);
    const theirs = await publish(b);
    await call('POST', `/api/shared/${theirs}/add`, { token: a.token });
    await report(a, theirs);
    await call('POST', '/api/blocks', { token: a.token, body: { userId: b.userId } });
    await call('POST', '/api/blocks', { token: b.token, body: { userId: a.userId } });
    await call('POST', '/api/drove', { token: a.token, body: { course: `s:${theirs}` } });
    await env.DB.prepare('INSERT INTO publish_bans (user_id, at) VALUES (?, 1)').bind(a.userId).run();
    expect((await call('DELETE', '/api/me', { token: a.token })).status).toBe(200);
    const count = async (sql: string, ...args: string[]) => Number((await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n);
    expect(await count('SELECT COUNT(*) AS n FROM public_courses WHERE owner_id = ?', a.userId)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM course_adds WHERE user_id = ? OR course_id = ?', a.userId, mine)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM course_reports WHERE user_id = ? OR course_id = ?', a.userId, mine)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM user_blocks WHERE user_id = ? OR blocked_id = ?', a.userId, a.userId)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM publish_bans WHERE user_id = ?', a.userId)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM course_drives WHERE user_id = ?', a.userId)).toBe(0);
    // b 의 코스는 그대로 (a 가 받은 수·신고 수는 남는다)
    expect((await call('GET', `/api/shared/${theirs}`, { token: b.token })).status).toBe(200);
  });

  it('익명 계정을 로그인 계정에 합치면 주행 신호·받기·안 보기도 옮긴다', async () => {
    const { mergeUsers } = await import('../src/login');
    const anon = await newUser();
    const into = await signedIn();
    const owner = await signedIn();
    const id = await publish(owner);
    await call('POST', `/api/shared/${id}/add`, { token: anon.token });
    await call('POST', '/api/blocks', { token: anon.token, body: { userId: owner.userId } });
    await call('POST', '/api/drove', { token: anon.token, body: { course: 'b:haogogae' } });
    await env.DB.batch(mergeUsers(env, anon.userId, into.userId));
    const one = async (sql: string, ...args: string[]) => (await env.DB.prepare(sql).bind(...args).first()) !== null;
    expect(await one('SELECT 1 FROM course_drives WHERE user_id = ?', into.userId)).toBe(true);
    expect(await one('SELECT 1 FROM course_adds WHERE user_id = ? AND course_id = ?', into.userId, id)).toBe(true);
    expect(await one('SELECT 1 FROM user_blocks WHERE user_id = ? AND blocked_id = ?', into.userId, owner.userId)).toBe(true);
    expect(await one('SELECT 1 FROM course_drives WHERE user_id = ?', anon.userId)).toBe(false);
  });
});

describe('인기 도로: 모두의 코스 신호', () => {
  it('s: 신호도 셈 ({builtin: "s:{id}", drivers})', async () => {
    const a = await newUser();
    const b = await newUser();
    const key = `s:${crypto.randomUUID()}`;
    await call('POST', '/api/drove', { token: a.token, body: { course: key } });
    await call('POST', '/api/drove', { token: b.token, body: { course: key } });
    const rows = (await (await call('GET', '/api/popular?period=7d', { token: a.token })).json()) as Array<{ builtin: string; drivers: number }>;
    expect(rows.find((r) => r.builtin === key)).toEqual({ builtin: key, drivers: 2 });
  });
});
