// 같이타요 API + 파일 게이트웨이 테스트 (사양서 10.1): 실제 Workers 런타임, R2·D1은 메모리.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../src/index';
import { MAX_FILE_BYTES } from '../src/files';
import { SIGNUP_LIMIT_PER_HOUR } from '../src/auth';

const ORIGIN = 'https://example.github.io';
const BASE = 'https://api.example.workers.dev';
// D1·R2 상태가 테스트끼리 이어지므로 id는 테스트마다 새로 만든다
let SESSION = crypto.randomUUID();
let COURSE = crypto.randomUUID();
const freshIds = () => {
  SESSION = crypto.randomUUID();
  COURSE = crypto.randomUUID();
};
let ipSeq = 0;

function req(method: string, path: string, init: { token?: string; body?: BodyInit | object; origin?: string | null; ip?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
  headers['CF-Connecting-IP'] = init.ip ?? `10.0.0.${++ipSeq}`;
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    if (init.body instanceof Uint8Array || init.body instanceof ReadableStream || typeof init.body === 'string') body = init.body as BodyInit;
    else {
      body = JSON.stringify(init.body);
      headers['Content-Type'] = 'application/json';
    }
  }
  return new Request(`${BASE}${path}`, { method, headers, body });
}
const call = (...a: Parameters<typeof req>) => handle(req(...a), env);
beforeEach(freshIds);

async function newUser(nickname = '민수') {
  const r = await call('POST', '/auth/signup', { body: { nickname } });
  expect(r.status).toBe(201);
  return (await r.json()) as { userId: string; token: string };
}

const course = (p: Record<string, unknown> = {}) => ({
  name: '오벌',
  kind: 'loop',
  source: 'auto',
  origin: { lat: 37.2, lon: 127.1 },
  start_gate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  finish_gate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  centerline: [
    [37.2, 127.1],
    [37.201, 127.1],
  ],
  length_m: 111,
  sector_bounds_m: [37, 74],
  version: 1,
  ...p,
});
const session = (userId: string, p: Record<string, unknown> = {}) => ({
  course_id: null,
  course_version: null,
  started_at: '2026-11-12T03:00:00.000Z',
  ended_at: '2026-11-12T03:20:00.000Z',
  device: { os: 'Android 15' },
  calibration: null,
  raw_key: `${userId}/${SESSION}.raw.json.gz`,
  processed_key: `${userId}/${SESSION}.processed.json.gz`,
  format_version: 1,
  ...p,
});
const lap = (lapNo: number, ms: number) => ({ lap_no: lapNo, lap_time_ms: ms, sector_times_ms: [1, 2, null], valid: true, invalid_reason: null, max_speed: 40.12, trace: { stepM: 5, t: [0], v: [1], alt: [null] } });

describe('익명 계정 (폰 열쇠)', () => {
  it('만들면 사용자 ID와 폰 열쇠를 주고, 서버에는 열쇠 원래 값을 저장하지 않는다', async () => {
    const u = await newUser('지훈');
    expect(u.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(u.token.length).toBeGreaterThanOrEqual(40);
    const me = await call('GET', '/api/me', { token: u.token });
    expect(await me.json()).toEqual({ userId: u.userId, nickname: '지훈' });
    const row = await env.DB.prepare('SELECT token_hash FROM users WHERE id = ?').bind(u.userId).first<{ token_hash: string }>();
    expect(row!.token_hash).not.toContain(u.token);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('닉네임 바꾸기, 1~20자가 아니면 400', async () => {
    const u = await newUser();
    expect((await call('PUT', '/api/me', { token: u.token, body: { nickname: '  새이름 ' } })).status).toBe(200);
    expect(((await (await call('GET', '/api/me', { token: u.token })).json()) as { nickname: string }).nickname).toBe('새이름');
    expect((await call('PUT', '/api/me', { token: u.token, body: { nickname: '' } })).status).toBe(400);
    expect((await call('POST', '/auth/signup', { body: { nickname: 'x'.repeat(21) } })).status).toBe(400);
    expect((await call('POST', '/auth/signup', { body: 'not json' })).status).toBe(400);
  });

  it('열쇠 없음·틀린 열쇠 → 401', async () => {
    expect((await call('GET', '/api/me')).status).toBe(401);
    expect((await call('GET', '/api/me', { token: 'x'.repeat(43) })).status).toBe(401);
  });

  it(`같은 IP에서 1시간에 ${SIGNUP_LIMIT_PER_HOUR}개까지만 만든다 (남용 방지)`, async () => {
    for (let i = 0; i < SIGNUP_LIMIT_PER_HOUR; i++) expect((await call('POST', '/auth/signup', { body: { nickname: 'a' }, ip: '9.9.9.9' })).status).toBe(201);
    expect((await call('POST', '/auth/signup', { body: { nickname: 'a' }, ip: '9.9.9.9' })).status).toBe(429);
    expect((await call('POST', '/auth/signup', { body: { nickname: 'a' }, ip: '9.9.9.8' })).status).toBe(201);
  });
});

describe('기록 표 (사양서 6.5): 본인 행만, 같은 id는 덮어쓰기', () => {
  it('코스: 올리고 다시 올리면 덮어쓴다. 다른 사람은 같은 id를 덮어쓸 수 없고 목록에도 안 보인다', async () => {
    const a = await newUser();
    const b = await newUser();
    expect((await call('PUT', `/api/courses/${COURSE}`, { token: a.token, body: course() })).status).toBe(200);
    expect((await call('PUT', `/api/courses/${COURSE}`, { token: a.token, body: course({ name: '이름 바꿈', version: 2 }) })).status).toBe(200);
    expect((await call('PUT', `/api/courses/${COURSE}`, { token: b.token, body: course({ name: '가로채기' }) })).status).toBe(403);
    const list = (await (await call('GET', '/api/courses', { token: a.token })).json()) as Array<{ name: string; version: number; centerline: unknown; start_gate: unknown }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: '이름 바꿈', version: 2, centerline: course().centerline, start_gate: course().start_gate });
    expect(await (await call('GET', '/api/courses', { token: b.token })).json()).toEqual([]);
  });

  it('잘못된 값은 400 (종류, 게이트, id)', async () => {
    const a = await newUser();
    expect((await call('PUT', `/api/courses/${COURSE}`, { token: a.token, body: course({ kind: 'circle' }) })).status).toBe(400);
    expect((await call('PUT', `/api/courses/${COURSE}`, { token: a.token, body: course({ start_gate: { lat: 'x' } }) })).status).toBe(400);
    expect((await call('PUT', '/api/courses/not-a-uuid', { token: a.token, body: course() })).status).toBe(400);
  });

  it('세션: 코스 없이도 올린다. 내 코스면 연결, 다른 사람 코스·없는 코스는 거부. 파일 키는 이 세션 것만', async () => {
    const a = await newUser();
    const b = await newUser();
    expect((await call('PUT', `/api/sessions/${SESSION}`, { token: a.token, body: session(a.userId) })).status).toBe(200);
    expect((await call('PUT', `/api/sessions/${SESSION}`, { token: a.token, body: session(a.userId, { course_id: COURSE, course_version: 1 }) })).status).toBe(400);
    await call('PUT', `/api/courses/${COURSE}`, { token: a.token, body: course() });
    expect((await call('PUT', `/api/sessions/${SESSION}`, { token: a.token, body: session(a.userId, { course_id: COURSE, course_version: 1 }) })).status).toBe(200);
    const row = await env.DB.prepare('SELECT course_id, owner_id FROM sessions WHERE id = ?').bind(SESSION).first<{ course_id: string; owner_id: string }>();
    expect(row).toEqual({ course_id: COURSE, owner_id: a.userId });
    // 다른 사람: 같은 세션 덮어쓰기 403, 남의 코스 연결 403, 남의 파일 키 400
    expect((await call('PUT', `/api/sessions/${SESSION}`, { token: b.token, body: session(b.userId) })).status).toBe(403);
    const other = crypto.randomUUID();
    expect((await call('PUT', `/api/sessions/${other}`, { token: b.token, body: session(b.userId, { course_id: COURSE, raw_key: null, processed_key: null }) })).status).toBe(403);
    expect((await call('PUT', `/api/sessions/${other}`, { token: b.token, body: session(b.userId, { raw_key: `${a.userId}/${SESSION}.raw.json.gz`, processed_key: null }) })).status).toBe(400);
  });

  it('랩: 통째로 바꾼다 (다시 처리해서 줄면 옛 랩이 남지 않음). 세션이 없거나 남의 것이면 거부', async () => {
    const a = await newUser();
    const b = await newUser();
    expect((await call('PUT', `/api/sessions/${SESSION}/laps`, { token: a.token, body: [lap(1, 60_000)] })).status).toBe(404);
    await call('PUT', `/api/sessions/${SESSION}`, { token: a.token, body: session(a.userId) });
    expect((await call('PUT', `/api/sessions/${SESSION}/laps`, { token: a.token, body: [lap(1, 60_000), lap(2, 61_000), lap(3, 62_000)] })).status).toBe(200);
    expect((await call('PUT', `/api/sessions/${SESSION}/laps`, { token: a.token, body: [lap(1, 59_000), lap(2, 61_500)] })).status).toBe(200);
    const { results } = await env.DB.prepare('SELECT lap_no, lap_time_ms, valid FROM laps WHERE session_id = ? ORDER BY lap_no').bind(SESSION).all();
    expect(results).toEqual([
      { lap_no: 1, lap_time_ms: 59_000, valid: 1 },
      { lap_no: 2, lap_time_ms: 61_500, valid: 1 },
    ]);
    expect((await call('PUT', `/api/sessions/${SESSION}/laps`, { token: b.token, body: [] })).status).toBe(403);
    expect((await call('PUT', `/api/sessions/${SESSION}/laps`, { token: a.token, body: [lap(1, 1), lap(1, 2)] })).status).toBe(400);
  });

  it('기록 지우기 (M10): 랩·세션 행과 원본·처리된 파일을 지운다. 남의 것은 403, 없는 것도 성공(다시 보내도 됨)', async () => {
    const a = await newUser();
    const b = await newUser();
    await call('PUT', `/api/sessions/${SESSION}`, { token: a.token, body: session(a.userId) });
    await call('PUT', `/api/sessions/${SESSION}/laps`, { token: a.token, body: [lap(1, 60_000)] });
    for (const kind of ['raw', 'processed']) await env.SESSION_FILES.put(`${a.userId}/${SESSION}.${kind}.json.gz`, new Uint8Array([1, 2, 3]));
    expect((await call('DELETE', `/api/sessions/${SESSION}`, { token: b.token })).status).toBe(403);
    const r = await call('DELETE', `/api/sessions/${SESSION}`, { token: a.token });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, existed: true });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM laps WHERE session_id = ?').bind(SESSION).first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?').bind(SESSION).first('n')).toBe(0);
    expect(await env.SESSION_FILES.head(`${a.userId}/${SESSION}.raw.json.gz`)).toBeNull();
    expect(await env.SESSION_FILES.head(`${a.userId}/${SESSION}.processed.json.gz`)).toBeNull();
    expect(await (await call('DELETE', `/api/sessions/${SESSION}`, { token: a.token })).json()).toEqual({ ok: true, existed: false });
    expect((await call('DELETE', `/api/sessions/${SESSION}/laps`, { token: a.token })).status).toBe(405);
  });
});

describe('파일 게이트웨이 (사양서 6.6, 10.1)', () => {
  const path = (user: string, kind = 'raw') => `/files/${user}/${SESSION}.${kind}.json.gz`;

  it('사전 요청(OPTIONS): 허용한 출처면 204와 CORS 헤더', async () => {
    const r = await call('OPTIONS', path('11111111-1111-4111-8111-111111111111'), { headers: { 'Access-Control-Request-Method': 'PUT' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('허용하지 않은 출처는 막는다 (CORS 헤더 없이 403)', async () => {
    const a = await newUser();
    for (const method of ['OPTIONS', 'GET']) {
      const r = await call(method, path(a.userId), { token: a.token, origin: 'https://evil.example.com' });
      expect(r.status).toBe(403);
      expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    expect((await call('POST', '/auth/signup', { body: { nickname: 'a' }, origin: 'https://evil.example.com' })).status).toBe(403);
  });

  it('열쇠 없음 → 401 (오류에도 CORS 헤더), 다른 사용자 폴더 → 403', async () => {
    const a = await newUser();
    const b = await newUser();
    const r = await call('GET', path(a.userId));
    expect(r.status).toBe(401);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((await call('PUT', path(a.userId), { token: b.token, body: new Uint8Array([1, 2, 3]) })).status).toBe(403);
  });

  it('잘못된 경로 → 400', async () => {
    const a = await newUser();
    for (const p of [
      `/files/${a.userId}/not-a-uuid.raw.json.gz`,
      `/files/abc/${SESSION}.raw.json.gz`,
      path(a.userId, 'other'),
      `/files/${a.userId}/${SESSION}.raw.json`,
      `/files/${a.userId}/${SESSION}.raw.json.gz/x`,
    ]) {
      expect((await call('GET', p, { token: a.token })).status, p).toBe(400);
    }
  });

  it('20 MB 넘는 파일 → 413 (길이를 밝히지 않은 스트림도)', async () => {
    const a = await newUser();
    expect((await call('PUT', path(a.userId), { token: a.token, body: new Uint8Array(MAX_FILE_BYTES + 1) })).status).toBe(413);
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 21; i++) c.enqueue(new Uint8Array(1024 * 1024));
        c.close();
      },
    });
    expect((await call('PUT', path(a.userId, 'processed'), { token: a.token, body: stream })).status).toBe(413);
    expect(await env.SESSION_FILES.head(`${a.userId}/${SESSION}.processed.json.gz`)).toBeNull();
  });

  it('올린 뒤 HEAD(크기)와 GET(내용)이 올린 파일과 같다. 같은 키는 덮어쓴다', async () => {
    const a = await newUser();
    const body = crypto.getRandomValues(new Uint8Array(5000));
    expect((await call('PUT', path(a.userId), { token: a.token, body })).status).toBe(201);
    const head = await call('HEAD', path(a.userId), { token: a.token });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('5000');
    expect(head.headers.get('Access-Control-Expose-Headers')).toContain('Content-Length');
    expect(new Uint8Array(await (await call('GET', path(a.userId), { token: a.token })).arrayBuffer())).toEqual(body);
    const body2 = new Uint8Array([9, 9, 9]);
    expect((await call('PUT', path(a.userId), { token: a.token, body: body2 })).status).toBe(201);
    expect(new Uint8Array(await (await call('GET', path(a.userId), { token: a.token })).arrayBuffer())).toEqual(body2);
  });

  it('없는 파일 → 404, 허용하지 않는 메서드 → 405, 없는 주소 → 404', async () => {
    const a = await newUser();
    expect((await call('GET', path(a.userId, 'processed'), { token: a.token })).status).toBe(404);
    expect((await call('HEAD', path(a.userId, 'processed'), { token: a.token })).status).toBe(404);
    expect((await call('DELETE', path(a.userId), { token: a.token })).status).toBe(405);
    expect((await call('GET', '/nothing')).status).toBe(404);
  });
});
