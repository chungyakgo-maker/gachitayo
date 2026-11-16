// 코스 둘러보기 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md): 즐겨찾기·분류 저장, 인기 도로, 주행 중 신호
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/index';

const ORIGIN = 'https://example.github.io';
const BASE = 'https://api.example.workers.dev';
let ipSeq = 0;
function call(method: string, path: string, init: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, 'CF-Connecting-IP': `10.9.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return handle(new Request(`${BASE}${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), env);
}
async function newUser() {
  const r = await call('POST', '/auth/signup', { body: { nickname: '민수' } });
  expect(r.status).toBe(201);
  return (await r.json()) as { userId: string; token: string };
}
const iso = (ms: number) => new Date(ms).toISOString();
async function builtinSession(userId: string, builtin: string, startedAt: string) {
  const courseId = crypto.randomUUID();
  const now = iso(Date.now());
  const gate = JSON.stringify({ lat: 37, lon: 127, bearingDeg: 0, widthM: 20 });
  await env.DB.prepare(
    `INSERT INTO courses (id, owner_id, name, kind, source, origin, start_gate, finish_gate, version, created_at, updated_at, builtin) VALUES (?, ?, 'x', 'point_to_point', 'gpx', ?, ?, ?, 1, ?, ?, ?)`,
  )
    .bind(courseId, userId, JSON.stringify({ lat: 37, lon: 127 }), gate, gate, now, now, builtin)
    .run();
  await env.DB.prepare(`INSERT INTO sessions (id, owner_id, course_id, course_version, started_at, format_version, created_at) VALUES (?, ?, ?, 1, ?, 1, ?)`)
    .bind(crypto.randomUUID(), userId, courseId, startedAt, now)
    .run();
}

describe('즐겨찾기·분류 /api/prefs', () => {
  it('starts empty and keeps what was saved', async () => {
    const u = await newUser();
    expect(await (await call('GET', '/api/prefs', { token: u.token })).json()).toEqual({ favorites: [], tags: {} });
    const prefs = { favorites: ['b:haogogae', 'c-123'], tags: { 'b:haogogae': ['mountain'], 'c-123': ['coast', 'mountain'] } };
    expect((await call('PUT', '/api/prefs', { token: u.token, body: prefs })).status).toBe(200);
    expect(await (await call('GET', '/api/prefs', { token: u.token })).json()).toEqual(prefs);
  });

  it('rejects unknown tags and bad shapes', async () => {
    const u = await newUser();
    expect((await call('PUT', '/api/prefs', { token: u.token, body: { favorites: [], tags: { a: ['winding'] } } })).status).toBe(400);
    expect((await call('PUT', '/api/prefs', { token: u.token, body: { favorites: 'x', tags: {} } })).status).toBe(400);
    expect((await call('PUT', '/api/prefs', { token: u.token, body: { favorites: Array.from({ length: 501 }, (_, i) => `k${i}`), tags: {} } })).status).toBe(400);
  });

  it('needs account', async () => {
    expect((await call('GET', '/api/prefs')).status).toBe(401);
  });
});

describe('인기 도로 /api/popular', () => {
  it('counts distinct drivers per built-in course in the period', async () => {
    const a = await newUser();
    const b = await newUser();
    const now = Date.now();
    const key = `pop-${crypto.randomUUID().slice(0, 8)}`;
    const other = `pop-${crypto.randomUUID().slice(0, 8)}`;
    await builtinSession(a.userId, key, iso(now - 2 * 86_400_000));
    await builtinSession(a.userId, key, iso(now - 3 * 86_400_000));
    await builtinSession(b.userId, key, iso(now - 20 * 86_400_000));
    await builtinSession(b.userId, other, iso(now - 1 * 86_400_000));
    const get = async (period: string) => ((await (await call('GET', `/api/popular?period=${period}`, { token: a.token })).json()) as Array<{ builtin: string; drivers: number }>).filter((r) => r.builtin === key || r.builtin === other);
    expect(await get('7d')).toEqual(expect.arrayContaining([{ builtin: key, drivers: 1 }, { builtin: other, drivers: 1 }]));
    expect(await get('30d')).toEqual([
      { builtin: key, drivers: 2 },
      { builtin: other, drivers: 1 },
    ]);
  });

  it('seasons count those months in any year (Korean time)', async () => {
    const a = await newUser();
    const key = `season-${crypto.randomUUID().slice(0, 8)}`;
    await builtinSession(a.userId, key, '2025-10-10T03:00:00.000Z'); // 가을
    await builtinSession(a.userId, `${key}-w`, '2025-11-30T16:00:00.000Z'); // 한국 시각 12월 1일 → 겨울
    const rows = async (p: string) => ((await (await call('GET', `/api/popular?period=${p}`, { token: a.token })).json()) as Array<{ builtin: string }>).map((r) => r.builtin);
    expect(await rows('autumn')).toContain(key);
    expect(await rows('autumn')).not.toContain(`${key}-w`);
    expect(await rows('winter')).toContain(`${key}-w`);
    expect(await rows('all')).toEqual(expect.arrayContaining([key, `${key}-w`]));
  });

  it('live counts driving signals from the last 10 minutes', async () => {
    const a = await newUser();
    const b = await newUser();
    const key = `live-${crypto.randomUUID().slice(0, 8)}`;
    expect((await call('POST', '/api/driving', { token: a.token, body: { builtin: key } })).status).toBe(200);
    expect((await call('POST', '/api/driving', { token: b.token, body: { builtin: key } })).status).toBe(200);
    await env.DB.prepare('UPDATE driving_now SET at = ? WHERE user_id = ?').bind(Date.now() - 11 * 60_000, b.userId).run();
    const live = ((await (await call('GET', '/api/popular?period=live', { token: a.token })).json()) as Array<{ builtin: string; drivers: number }>).filter((r) => r.builtin === key);
    expect(live).toEqual([{ builtin: key, drivers: 1 }]);
  });

  it('bad period is 400', async () => {
    const a = await newUser();
    expect((await call('GET', '/api/popular?period=year', { token: a.token })).status).toBe(400);
  });

  it('driving signal needs a built-in key', async () => {
    const a = await newUser();
    expect((await call('POST', '/api/driving', { token: a.token, body: {} })).status).toBe(400);
  });
});
