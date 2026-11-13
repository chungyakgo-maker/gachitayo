// 카카오 로그인 (설계 docs/superpowers/specs/2026-11-13-kakao-login-design.md): 여러 기기 열쇠, 로그아웃, providers,
// 시작·콜백·마치기, 연결·새로 만들기·합치기
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../src/index';
import { issueToken } from '../src/auth';

const ORIGIN = 'https://example.github.io';
const BASE = 'https://api.example.workers.dev';
let ipSeq = 0;

function req(method: string, path: string, init: { token?: string; body?: object | string | Uint8Array; origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
  headers['CF-Connecting-IP'] = init.ip ?? `10.1.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  let body: BodyInit | undefined;
  if (init.body instanceof Uint8Array) body = init.body;
  else if (init.body !== undefined) {
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    headers['Content-Type'] = 'application/json';
  }
  return new Request(`${BASE}${path}`, { method, headers, body, redirect: 'manual' });
}
const call = (...a: Parameters<typeof req>) => handle(req(...a), env);

async function newUser(nickname = '민수') {
  const r = await call('POST', '/auth/signup', { body: { nickname } });
  expect(r.status).toBe(201);
  return (await r.json()) as { userId: string; token: string };
}
const me = async (token: string) => call('GET', '/api/me', { token });

describe('여러 기기 열쇠·로그아웃·providers', () => {
  it('user_tokens 열쇠로도 들어오고, 연결 전에는 kakao: false', async () => {
    const u = await newUser();
    const t2 = await issueToken(env, u.userId);
    const r = await me(t2);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ userId: u.userId, nickname: '민수', kakao: false });
  });

  it('로그아웃하면 그 열쇠만 401, 같은 계정의 다른 열쇠는 그대로', async () => {
    const u = await newUser();
    const t2 = await issueToken(env, u.userId);
    expect((await call('POST', '/auth/logout', { token: t2 })).status).toBe(200);
    expect((await me(t2)).status).toBe(401);
    expect((await me(u.token)).status).toBe(200);
  });

  it('첫 익명 열쇠로 로그아웃해도 그 열쇠는 401', async () => {
    const u = await newUser();
    const t2 = await issueToken(env, u.userId);
    expect((await call('POST', '/auth/logout', { token: u.token })).status).toBe(200);
    expect((await me(u.token)).status).toBe(401);
    expect((await me(t2)).status).toBe(200);
  });

  it('로그아웃은 열쇠가 없으면 401', async () => {
    expect((await call('POST', '/auth/logout')).status).toBe(401);
  });

  it('providers: 카카오 비밀값이 있으면 kakao: true, 없으면 false', async () => {
    expect(await (await call('GET', '/auth/providers')).json()).toEqual({ kakao: true });
    const r = await handle(req('GET', '/auth/providers'), { ...env, KAKAO_REST_API_KEY: undefined });
    expect(await r.json()).toEqual({ kakao: false });
  });

  it('카카오가 연결된 계정은 /api/me가 kakao: true', async () => {
    const u = await newUser();
    await env.DB.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('kakao', ?, ?, ?)").bind(`k-${u.userId}`, u.userId, new Date().toISOString()).run();
    expect(((await (await me(u.token)).json()) as { kakao: boolean }).kakao).toBe(true);
  });
});

// ── 카카오 흉내: 토큰 교환과 회원 정보 ─────────────────────────
let kakao: { id: number; nickname: string } = { id: 1, nickname: '카카오민수' };
const tokenCalls: URLSearchParams[] = [];
beforeEach(() => {
  tokenCalls.length = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://kauth.kakao.com/oauth/token') {
      tokenCalls.push(new URLSearchParams(String(init?.body)));
      return Response.json({ access_token: 'kakao-access', token_type: 'bearer' });
    }
    if (url === 'https://kapi.kakao.com/v2/user/me') {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer kakao-access');
      return Response.json({ id: kakao.id, kakao_account: { profile: { nickname: kakao.nickname } } });
    }
    throw new Error(`예상하지 못한 호출 ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

const RETURN_TO = `${ORIGIN}/gachitayo/`;
let kakaoSeq = 1000;
const nextKakaoId = () => ++kakaoSeq;
const b64 = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/[+/=]/g, 'x');
async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function start(opts: { token?: string; returnTo?: string; ip?: string } = {}) {
  const verifier = b64(32);
  const res = await call('POST', '/auth/kakao/start', { token: opts.token, ip: opts.ip, body: { returnTo: opts.returnTo ?? RETURN_TO, verifierHash: await sha256Hex(verifier) } });
  const url = res.status === 200 ? new URL(((await res.json()) as { url: string }).url) : null;
  return { res, url, state: url?.searchParams.get('state') ?? '', verifier };
}
const callback = (query: string) => call('GET', `/auth/kakao/callback?${query}`, { origin: null });
function hashQuery(res: Response) {
  const loc = res.headers.get('Location') ?? '';
  const [base, hash = ''] = loc.split('#');
  return { base, hash, q: new URLSearchParams(hash.split('?')[1] ?? '') };
}
const finish = (b: { state: string; verifier: string; pin: string }, token?: string) => call('POST', '/auth/kakao/finish', { token, body: b });

/** 시작 → 카카오 → 콜백 → 마치기 */
async function login(opts: { token?: string; kakaoId: number; nickname?: string }) {
  kakao = { id: opts.kakaoId, nickname: opts.nickname ?? '카카오민수' };
  const s = await start({ token: opts.token });
  expect(s.res.status).toBe(200);
  const cb = await callback(`code=c-${opts.kakaoId}&state=${s.state}`);
  expect(cb.status).toBe(302);
  const pin = hashQuery(cb).q.get('pin')!;
  const r = await finish({ state: s.state, verifier: s.verifier, pin }, opts.token);
  expect(r.status).toBe(200);
  return (await r.json()) as { userId: string; token: string; nickname: string; kind: string };
}

describe('카카오 시작·콜백·마치기', () => {
  it('시작하면 state와 리다이렉트 주소가 든 카카오 인가 주소를 준다', async () => {
    const s = await start();
    expect(s.res.status).toBe(200);
    expect(s.url!.origin + s.url!.pathname).toBe('https://kauth.kakao.com/oauth/authorize');
    expect(s.url!.searchParams.get('client_id')).toBe('test-rest-key');
    expect(s.url!.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/kakao/callback`);
    expect(s.url!.searchParams.get('response_type')).toBe('code');
    expect(s.state.length).toBeGreaterThanOrEqual(22);
  });

  it('허용 출처 밖의 returnTo나 잘못된 verifierHash는 400', async () => {
    expect((await start({ returnTo: 'https://evil.example/' })).res.status).toBe(400);
    expect((await start({ returnTo: 'https://example.github.io.evil.example/' })).res.status).toBe(400);
    const r = await call('POST', '/auth/kakao/start', { body: { returnTo: RETURN_TO, verifierHash: 'abc' } });
    expect(r.status).toBe(400);
  });

  it('카카오 비밀값이 없으면 시작은 503', async () => {
    const r = await handle(req('POST', '/auth/kakao/start', { body: { returnTo: RETURN_TO, verifierHash: 'a'.repeat(64) } }), { ...env, KAKAO_CLIENT_SECRET: undefined });
    expect(r.status).toBe(503);
  });

  it('같은 IP에서 1시간에 30번까지 시작', async () => {
    for (let i = 0; i < 30; i++) expect((await start({ ip: '8.8.4.4' })).res.status).toBe(200);
    expect((await start({ ip: '8.8.4.4' })).res.status).toBe(429);
  });

  it('콜백만으로는 계정이 바뀌지 않는다 (남이 보낸 링크 대비)', async () => {
    const b = await newUser();
    const id = nextKakaoId();
    kakao = { id, nickname: '피해자' };
    const s = await start({ token: b.token });
    const cb = await callback(`code=c1&state=${s.state}`);
    expect(cb.status).toBe(302);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE provider = 'kakao' AND subject = ?").bind(String(id)).first<{ n: number }>();
    expect(n!.n).toBe(0);
    expect(((await (await me(b.token)).json()) as { kakao: boolean }).kakao).toBe(false);
  });

  it('콜백은 returnTo#/auth/kakao?state=&pin=(6자리)로 보내고, 토큰 교환에 비밀값과 같은 리다이렉트 주소를 쓴다', async () => {
    kakao = { id: nextKakaoId(), nickname: 'x' };
    const s = await start();
    const cb = await callback(`code=abc&state=${s.state}`);
    const h = hashQuery(cb);
    expect(h.base).toBe(RETURN_TO);
    expect(h.hash.startsWith('/auth/kakao?')).toBe(true);
    expect(h.q.get('state')).toBe(s.state);
    expect(h.q.get('pin')).toMatch(/^\d{6}$/);
    expect(tokenCalls[0]!.get('client_secret')).toBe('test-secret');
    expect(tokenCalls[0]!.get('redirect_uri')).toBe(`${BASE}/auth/kakao/callback`);
    expect(tokenCalls[0]!.get('code')).toBe('abc');
  });

  it('처음 보는 카카오 + 계정 없음 → 새 계정 (카카오 닉네임)', async () => {
    const r = await login({ kakaoId: nextKakaoId(), nickname: '드리프트왕' });
    expect(r.kind).toBe('created');
    expect(r.nickname).toBe('드리프트왕');
    expect(await (await me(r.token)).json()).toEqual({ userId: r.userId, nickname: '드리프트왕', kakao: true });
  });

  it('처음 보는 카카오 + 익명 B → B에 연결 (닉네임은 B 것 그대로)', async () => {
    const b = await newUser('지훈');
    const r = await login({ token: b.token, kakaoId: nextKakaoId(), nickname: '다른이름' });
    expect(r.kind).toBe('linked');
    expect(r.userId).toBe(b.userId);
    expect(r.nickname).toBe('지훈');
    expect(((await (await me(r.token)).json()) as { kakao: boolean }).kakao).toBe(true);
  });

  it('아는 카카오 + 계정 없음 → 그 계정으로 로그인', async () => {
    const id = nextKakaoId();
    const first = await login({ kakaoId: id });
    const again = await login({ kakaoId: id });
    expect(again.kind).toBe('login');
    expect(again.userId).toBe(first.userId);
    expect(again.token).not.toBe(first.token);
    expect((await me(first.token)).status).toBe(200);
  });

  it('다른 카카오에 연결된 계정 B에서 아는 카카오로 → 합치지 않고 전환', async () => {
    const a = await login({ kakaoId: nextKakaoId() });
    const b = await login({ kakaoId: nextKakaoId() });
    const r = await login({ token: b.token, kakaoId: Number((await env.DB.prepare('SELECT subject FROM identities WHERE user_id = ?').bind(a.userId).first<{ subject: string }>())!.subject) });
    expect(r.kind).toBe('switched');
    expect(r.userId).toBe(a.userId);
  });

  it('B로 시작했으면 마치기에도 B 열쇠가 있어야 한다', async () => {
    const b = await newUser();
    kakao = { id: nextKakaoId(), nickname: 'x' };
    const s = await start({ token: b.token });
    const pin = hashQuery(await callback(`code=c&state=${s.state}`)).q.get('pin')!;
    expect((await finish({ state: s.state, verifier: s.verifier, pin })).status).toBe(403);
  });

  it('틀린 번호·verifier는 횟수를 세고, 5번째에 그 로그인은 끝난다', async () => {
    kakao = { id: nextKakaoId(), nickname: 'x' };
    const s = await start();
    const pin = hashQuery(await callback(`code=c&state=${s.state}`)).q.get('pin')!;
    const wrong = pin === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) expect((await finish({ state: s.state, verifier: s.verifier, pin: wrong })).status).toBe(403);
    expect((await finish({ state: s.state, verifier: b64(32), pin })).status).toBe(403);
    expect((await finish({ state: s.state, verifier: s.verifier, pin: wrong })).status).toBe(403);
    expect((await finish({ state: s.state, verifier: s.verifier, pin })).status).toBe(410);
  });

  it('같은 state로는 한 번만 마칠 수 있다', async () => {
    kakao = { id: nextKakaoId(), nickname: 'x' };
    const s = await start();
    const pin = hashQuery(await callback(`code=c&state=${s.state}`)).q.get('pin')!;
    const [r1, r2] = await Promise.all([finish({ state: s.state, verifier: s.verifier, pin }), finish({ state: s.state, verifier: s.verifier, pin })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 410]);
  });

  it('10분이 지나면 콜백은 400 안내 화면, 마치기는 410', async () => {
    kakao = { id: nextKakaoId(), nickname: 'x' };
    const s1 = await start();
    await env.DB.prepare('UPDATE oauth_states SET created_at = created_at - 660000 WHERE state = ?').bind(s1.state).run();
    const cb = await callback(`code=c&state=${s1.state}`);
    expect(cb.status).toBe(400);
    expect(cb.headers.get('Content-Type')).toContain('text/html');
    expect(await cb.text()).toContain('다시 시도');
    const s2 = await start();
    const pin = hashQuery(await callback(`code=c&state=${s2.state}`)).q.get('pin')!;
    await env.DB.prepare('UPDATE oauth_states SET created_at = created_at - 660000 WHERE state = ?').bind(s2.state).run();
    expect((await finish({ state: s2.state, verifier: s2.verifier, pin })).status).toBe(410);
  });

  it('카카오에서 취소하면 error=cancelled로 돌려보낸다', async () => {
    const s = await start();
    const cb = await callback(`error=access_denied&state=${s.state}`);
    expect(cb.status).toBe(302);
    const h = hashQuery(cb);
    expect(h.q.get('error')).toBe('cancelled');
    expect(h.q.get('state')).toBe(s.state);
    expect(h.q.get('pin')).toBeNull();
  });

  it('카카오 닉네임은 20자(코드포인트)까지, 비면 드라이버', async () => {
    const long = '🚗'.repeat(30);
    const r1 = await login({ kakaoId: nextKakaoId(), nickname: long });
    expect(r1.nickname).toBe('🚗'.repeat(20));
    const r2 = await login({ kakaoId: nextKakaoId(), nickname: '   ' });
    expect(r2.nickname).toBe('드라이버');
  });
});

// ── 합치기 (설계 5.4) ─────────────────────────────────────
const courseBody = { name: '오벌', kind: 'loop', source: 'auto', origin: { lat: 37.2, lon: 127.1 }, start_gate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 }, finish_gate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 }, centerline: [[37.2, 127.1], [37.201, 127.1]], length_m: 111, sector_bounds_m: null, version: 1 };
const sessionBody = (userId: string, sid: string, courseId: string | null) => ({
  course_id: courseId,
  course_version: courseId ? 1 : null,
  started_at: '2026-11-12T03:00:00.000Z',
  ended_at: '2026-11-12T03:20:00.000Z',
  device: { os: 'iOS 18' },
  calibration: null,
  raw_key: `${userId}/${sid}.raw.json.gz`,
  processed_key: `${userId}/${sid}.processed.json.gz`,
  format_version: 1,
});
const lapBody = [{ lap_no: 1, lap_time_ms: 61000, sector_times_ms: null, valid: true, invalid_reason: null, max_speed: 30, trace: null }];
const RAW = new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4, 5]);

/** 익명 B: 코스 1, 세션 1(파일 둘, 랩 1) */
async function anonWithData() {
  const b = await newUser('익명비');
  const cid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  expect((await call('PUT', `/api/courses/${cid}`, { token: b.token, body: courseBody })).status).toBe(200);
  expect((await call('PUT', `/files/${b.userId}/${sid}.raw.json.gz`, { token: b.token, body: RAW })).status).toBe(201);
  expect((await call('PUT', `/files/${b.userId}/${sid}.processed.json.gz`, { token: b.token, body: RAW })).status).toBe(201);
  expect((await call('PUT', `/api/sessions/${sid}`, { token: b.token, body: sessionBody(b.userId, sid, cid) })).status).toBe(200);
  expect((await call('PUT', `/api/sessions/${sid}/laps`, { token: b.token, body: lapBody })).status).toBe(200);
  return { ...b, cid, sid };
}
async function friendsOf(token: string) {
  return (await (await call('GET', '/api/friends', { token })).json()) as { code: string; friends: Array<{ userId: string }> };
}

describe('계정 합치기 (익명 B → 카카오 계정 A)', () => {
  it('B의 코스·기록·랩·파일·친구가 A로 오고, B 열쇠는 더 못 쓴다', async () => {
    const kid = nextKakaoId();
    const a = await login({ kakaoId: kid });
    const b = await anonWithData();
    const c = await newUser('친구씨');
    expect((await call('POST', '/api/friends', { token: b.token, body: { code: (await friendsOf(c.token)).code } })).status).toBe(200);

    const r = await login({ token: b.token, kakaoId: kid });
    expect(r.kind).toBe('merged');
    expect(r.userId).toBe(a.userId);

    const sessions = (await (await call('GET', '/api/sessions', { token: r.token })).json()) as Array<{ id: string; courseId: string; rawKey: string; startedAt: string }>;
    expect(sessions.map((x) => x.id)).toEqual([b.sid]);
    expect(sessions[0]).toMatchObject({ courseId: b.cid, rawKey: `${b.userId}/${b.sid}.raw.json.gz`, startedAt: '2026-11-12T03:00:00.000Z' });
    const courses = (await (await call('GET', '/api/courses', { token: r.token })).json()) as Array<{ id: string }>;
    expect(courses.map((x) => x.id)).toEqual([b.cid]);
    const laps = await env.DB.prepare('SELECT owner_id FROM laps WHERE session_id = ?').bind(b.sid).first<{ owner_id: string }>();
    expect(laps!.owner_id).toBe(a.userId);

    const raw = await call('GET', `/files/${a.userId}/${b.sid}.raw.json.gz`, { token: r.token });
    expect(raw.status).toBe(200);
    expect(new Uint8Array(await raw.arrayBuffer())).toEqual(RAW);
    expect((await call('HEAD', `/files/${a.userId}/${b.sid}.processed.json.gz`, { token: r.token })).status).toBe(200);

    expect((await friendsOf(c.token)).friends.map((f) => f.userId)).toEqual([a.userId]);
    expect((await friendsOf(r.token)).friends.map((f) => f.userId)).toEqual([c.userId]);
    expect((await me(b.token)).status).toBe(401);
    expect(await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(b.userId).first()).toBeNull();
  });

  it('합친 기록을 지우면 저장된 경로(B 폴더)의 파일도 지운다', async () => {
    const kid = nextKakaoId();
    await login({ kakaoId: kid });
    const b = await anonWithData();
    const r = await login({ token: b.token, kakaoId: kid });
    expect((await call('DELETE', `/api/sessions/${b.sid}`, { token: r.token })).status).toBe(200);
    expect(await env.SESSION_FILES.head(`${b.userId}/${b.sid}.raw.json.gz`)).toBeNull();
    expect(await env.SESSION_FILES.head(`${b.userId}/${b.sid}.processed.json.gz`)).toBeNull();
  });

  it('합친 기록을 A 경로로 다시 올려도 저장된 파일 경로는 그대로라 받을 수 있다', async () => {
    const kid = nextKakaoId();
    const a = await login({ kakaoId: kid });
    const b = await anonWithData();
    const r = await login({ token: b.token, kakaoId: kid });
    expect((await call('PUT', `/api/sessions/${b.sid}`, { token: r.token, body: sessionBody(a.userId, b.sid, b.cid) })).status).toBe(200);
    expect((await call('GET', `/files/${a.userId}/${b.sid}.raw.json.gz`, { token: r.token })).status).toBe(200);
  });

  it('A와 B가 서로 친구였으면 자기 자신 친구는 생기지 않는다', async () => {
    const kid = nextKakaoId();
    const a = await login({ kakaoId: kid });
    const b = await newUser();
    expect((await call('POST', '/api/friends', { token: b.token, body: { code: (await friendsOf(a.token)).code } })).status).toBe(200);
    const r = await login({ token: b.token, kakaoId: kid });
    expect((await friendsOf(r.token)).friends).toEqual([]);
  });

  it('기록 목록은 내 것만', async () => {
    const x = await anonWithData();
    const y = await newUser();
    expect(await (await call('GET', '/api/sessions', { token: y.token })).json()).toEqual([]);
    expect(((await (await call('GET', '/api/sessions', { token: x.token })).json()) as unknown[]).length).toBe(1);
  });

  it('코스의 기본 코스 키를 저장하고 돌려준다 (40자 넘으면 400)', async () => {
    const u = await newUser();
    const cid = crypto.randomUUID();
    expect((await call('PUT', `/api/courses/${cid}`, { token: u.token, body: { ...courseBody, builtin: 'baehu' } })).status).toBe(200);
    const list = (await (await call('GET', '/api/courses', { token: u.token })).json()) as Array<{ builtin: string | null }>;
    expect(list[0]!.builtin).toBe('baehu');
    expect((await call('PUT', `/api/courses/${crypto.randomUUID()}`, { token: u.token, body: { ...courseBody, builtin: 'x'.repeat(41) } })).status).toBe(400);
    const plain = crypto.randomUUID();
    await call('PUT', `/api/courses/${plain}`, { token: u.token, body: courseBody });
    const all = (await (await call('GET', '/api/courses', { token: u.token })).json()) as Array<{ id: string; builtin: string | null }>;
    expect(all.find((c) => c.id === plain)!.builtin).toBeNull();
  });
});
