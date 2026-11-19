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

  it('old driving signals are removed', async () => {
    const a = await newUser();
    const b = await newUser();
    await call('POST', '/api/driving', { token: a.token, body: { builtin: 'old' } });
    await env.DB.prepare('UPDATE driving_now SET at = ? WHERE user_id = ?').bind(Date.now() - 11 * 60_000, a.userId).run();
    await call('POST', '/api/driving', { token: b.token, body: { builtin: 'new' } });
    const left = await env.DB.prepare('SELECT user_id FROM driving_now WHERE user_id = ?').bind(a.userId).first();
    expect(left).toBeNull();
  });

  it('bad period is 400', async () => {
    const a = await newUser();
    expect((await call('GET', '/api/popular?period=year', { token: a.token })).status).toBe(400);
    expect((await call('GET', '/api/popular?period=constructor', { token: a.token })).status).toBe(400);
  });

  it('driving signal needs a built-in key', async () => {
    const a = await newUser();
    expect((await call('POST', '/api/driving', { token: a.token, body: {} })).status).toBe(400);
  });
});

// 기록은 폰에만 (설계 2026-11-18-local-records-course-share-design.md "인기 도로"): 기록을 안 올리니 코스 열쇠만 받는 새 신호
describe('주행 신호 /api/drove (위치 없음)', () => {
  it('같은 날 두 번 보내도 한 줄, 날짜는 한국 날짜', async () => {
    const a = await newUser();
    const key = `b:dr-${crypto.randomUUID().slice(0, 8)}`;
    expect((await call('POST', '/api/drove', { token: a.token, body: { course: key } })).status).toBe(200);
    expect((await call('POST', '/api/drove', { token: a.token, body: { course: key } })).status).toBe(200);
    const rows = await env.DB.prepare('SELECT day FROM course_drives WHERE user_id = ? AND course_key = ?').bind(a.userId, key).all<{ day: string }>();
    expect(rows.results.length).toBe(1);
    expect(rows.results[0]!.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('인기 = 예전 세션 계정 ∪ 새 신호 계정 (같은 사람은 한 번)', async () => {
    const a = await newUser();
    const b = await newUser();
    const c = await newUser();
    const key = `mix-${crypto.randomUUID().slice(0, 8)}`;
    await builtinSession(a.userId, key, iso(Date.now() - 2 * 86_400_000));
    await call('POST', '/api/drove', { token: a.token, body: { course: `b:${key}` } });
    await call('POST', '/api/drove', { token: b.token, body: { course: `b:${key}` } });
    await call('POST', '/api/drove', { token: c.token, body: { course: `b:${key}` } });
    await env.DB.prepare('UPDATE course_drives SET day = ? WHERE user_id = ?').bind('2020-01-15', c.userId).run(); // 오래전 겨울
    const get = async (p: string) => ((await (await call('GET', `/api/popular?period=${p}`, { token: a.token })).json()) as Array<{ builtin: string; drivers: number }>).find((r) => r.builtin === key);
    expect(await get('7d')).toEqual({ builtin: key, drivers: 2 });
    expect(await get('all')).toEqual({ builtin: key, drivers: 3 });
    expect(await get('winter')).toEqual({ builtin: key, drivers: 1 });
  });

  it('잘못된 열쇠는 400 (b: 또는 s: 로 시작, 80자 이하)', async () => {
    const a = await newUser();
    for (const course of [undefined, '', 'haogogae', `b:${'x'.repeat(80)}`, 12]) {
      expect((await call('POST', '/api/drove', { token: a.token, body: { course } })).status).toBe(400);
    }
    expect((await call('POST', '/api/drove', { token: a.token, body: { course: 's:abc' } })).status).toBe(200);
  });

  it('모두의 코스 신호가 많아도 기본 코스 20줄은 그대로 (예전 앱의 인기 도로가 밀리지 않게)', async () => {
    const users = await Promise.all(Array.from({ length: 3 }, () => newUser()));
    for (let i = 0; i < 25; i++) for (const u of users) await call('POST', '/api/drove', { token: u.token, body: { course: `s:flood-${i}` } });
    const a = await newUser();
    await call('POST', '/api/drove', { token: a.token, body: { course: 'b:quiet-builtin' } });
    const rows = (await (await call('GET', '/api/popular?period=all', { token: a.token })).json()) as Array<{ builtin: string }>;
    expect(rows.some((r) => r.builtin === 'quiet-builtin')).toBe(true);
    expect(rows.filter((r) => !r.builtin.startsWith('s:')).length).toBeLessThanOrEqual(20);
    expect(rows.filter((r) => r.builtin.startsWith('s:')).length).toBeLessThanOrEqual(20);
  }, 60_000);
});
