// 애플 로그인 (앱 로그인 설계 docs/superpowers/specs/2026-11-17-app-login-design.md): identityToken 확인, 계정 규칙, 연결 끊기
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../src/index';
import { resetAppleKeysForTest } from '../src/apple';

const APP = 'capacitor://localhost';
const BASE = 'https://api.example.workers.dev';
let ipSeq = 0;
function req(method: string, path: string, init: { token?: string; body?: object } = {}) {
  const headers: Record<string, string> = { Origin: APP, 'CF-Connecting-IP': `10.7.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body) headers['Content-Type'] = 'application/json';
  return new Request(`${BASE}${path}`, { method, headers, body: init.body ? JSON.stringify(init.body) : undefined });
}

// ── 애플 흉내: 서명 키(공개 키를 애플 키 목록으로), Sign in with Apple 키(.p8) ──
const rsa = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const jwk = { ...((await crypto.subtle.exportKey('jwk', rsa.publicKey)) as JsonWebKey), kid: 'k1', alg: 'RS256', use: 'sig' };
const other = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const ec = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', ec.privateKey)) as ArrayBuffer);
const P8 = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
const withKeys = { ...env, APPLE_SIGNIN_KEY_P8: P8, APPLE_SIGNIN_KEY_ID: 'KID1', APPLE_TEAM_ID: 'TEAM1' };

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function idToken(o: { sub: string; nonce: string; aud?: string; exp?: number; key?: CryptoKey; alg?: string; iss?: string }) {
  const h = enc({ alg: o.alg ?? 'RS256', kid: 'k1' });
  const p = enc({ iss: o.iss ?? 'https://appleid.apple.com', aud: o.aud ?? 'kr.dgo.app', exp: o.exp ?? Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), sub: o.sub, nonce: await sha256Hex(o.nonce), jti: crypto.randomUUID() });
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', o.key ?? rsa.privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

const tokenCalls: URLSearchParams[] = [];
const revokeCalls: URLSearchParams[] = [];
let keyFetches = 0;
/** 애플 code 교환이 돌려줄 사용자 번호 (보통 로그인한 사람 것) */
let codeSub = '';
beforeEach(() => {
  resetAppleKeysForTest();
  tokenCalls.length = 0;
  revokeCalls.length = 0;
  keyFetches = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://appleid.apple.com/auth/keys') {
      keyFetches++;
      return Response.json({ keys: [jwk] });
    }
    if (url === 'https://appleid.apple.com/auth/token') {
      tokenCalls.push(new URLSearchParams(String(init?.body)));
      return Response.json({ refresh_token: 'rt-1', access_token: 'at', id_token: `${enc({ alg: 'RS256' })}.${enc({ sub: codeSub })}.sig` });
    }
    if (url === 'https://appleid.apple.com/auth/revoke') {
      revokeCalls.push(new URLSearchParams(String(init?.body)));
      return new Response(null, { status: 200 });
    }
    throw new Error(`예상하지 못한 호출 ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

let subSeq = 0;
const nextSub = () => `001234.apple${++subSeq}.0001`;
const NONCE = 'n'.repeat(32);
async function apple(o: { sub: string; token?: string; nickname?: string; e?: Cloudflare.Env; idt?: string; nonce?: string; codeSub?: string }) {
  codeSub = o.codeSub ?? o.sub;
  const body = { identityToken: o.idt ?? (await idToken({ sub: o.sub, nonce: NONCE })), authorizationCode: 'code-1', nonce: o.nonce ?? NONCE, nickname: o.nickname };
  return handle(req('POST', '/auth/apple', { token: o.token, body }), o.e ?? env);
}
const ok = async (r: Response) => {
  expect(r.status).toBe(200);
  return (await r.json()) as { userId: string; token: string; nickname: string; kind: string };
};
const me = async (token: string) => (await handle(req('GET', '/api/me', { token }), env)).json() as Promise<{ userId: string; nickname: string; kakao: boolean; apple: boolean }>;
async function newUser(nickname = '민수') {
  return (await (await handle(req('POST', '/auth/signup', { body: { nickname } }), env)).json()) as { userId: string; token: string };
}

describe('애플 로그인', () => {
  it('providers에 apple: true', async () => {
    expect(await (await handle(req('GET', '/auth/providers'), env)).json()).toMatchObject({ apple: true });
  });

  it('처음 보는 애플 + 계정 없음 → 새 계정 (애플이 준 이름, 없으면 드라이버)', async () => {
    const r = await ok(await apple({ sub: nextSub(), nickname: '홍길동' }));
    expect(r.kind).toBe('created');
    expect(r.nickname).toBe('홍길동');
    expect(await me(r.token)).toEqual({ userId: r.userId, nickname: '홍길동', avatar: null, kakao: false, apple: true });
    expect((await ok(await apple({ sub: nextSub() }))).nickname).toBe('드라이버');
  });

  it('처음 보는 애플 + 익명 계정 → 그 계정에 연결, 예전 열쇠는 못 씀', async () => {
    const b = await newUser('지훈');
    const r = await ok(await apple({ sub: nextSub(), token: b.token, nickname: '다른이름' }));
    expect(r.kind).toBe('linked');
    expect(r.userId).toBe(b.userId);
    expect(r.nickname).toBe('지훈');
    expect((await handle(req('GET', '/api/me', { token: b.token }), env)).status).toBe(401);
    expect((await me(r.token)).apple).toBe(true);
  });

  it('아는 애플 + 다른 익명 계정 → 합치기 (익명 계정은 없어짐)', async () => {
    const sub = nextSub();
    const a = await ok(await apple({ sub }));
    const b = await newUser('익명');
    const r = await ok(await apple({ sub, token: b.token }));
    expect(r.kind).toBe('merged');
    expect(r.userId).toBe(a.userId);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').bind(b.userId).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('카카오가 붙은 계정에서 애플을 더 붙이면 같은 계정에 둘 다', async () => {
    const b = await newUser('카카오사람');
    await env.DB.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('kakao', ?, ?, ?)").bind(`k-${b.userId}`, b.userId, new Date().toISOString()).run();
    const r = await ok(await apple({ sub: nextSub(), token: b.token }));
    expect(r.kind).toBe('linked');
    expect(await me(r.token)).toMatchObject({ userId: b.userId, kakao: true, apple: true });
  });

  it('잘못된 토큰은 401: 다른 키 서명, 다른 앱(aud), 만료, nonce 다름, 다른 발급자, alg 바꿔치기', async () => {
    const sub = nextSub();
    const bad = [
      await idToken({ sub, nonce: NONCE, key: other.privateKey }),
      await idToken({ sub, nonce: NONCE, aud: 'com.other.app' }),
      await idToken({ sub, nonce: NONCE, exp: Math.floor(Date.now() / 1000) - 10 }),
      await idToken({ sub, nonce: 'm'.repeat(32) }),
      await idToken({ sub, nonce: NONCE, iss: 'https://evil.example' }),
      await idToken({ sub, nonce: NONCE, alg: 'none' }),
      'not.a.jwt',
      `${(await idToken({ sub, nonce: NONCE })).split('.').slice(0, 2).join('.')}.%%%`,
    ];
    for (const idt of bad) expect((await apple({ sub, idt })).status).toBe(401);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE provider = 'apple' AND subject = ?").bind(sub).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('같은 애플 로그인(identityToken)을 다시 보내면 401 (가로챈 요청 재사용 막기)', async () => {
    const sub = nextSub();
    const idt = await idToken({ sub, nonce: NONCE });
    await ok(await apple({ sub, idt }));
    expect((await apple({ sub, idt })).status).toBe(401);
  });

  it('모르는 키 번호로 계속 보내도 애플 공개 키는 1분에 한 번만 다시 받는다', async () => {
    const h = enc({ alg: 'RS256', kid: 'nope' });
    const p = enc({ sub: 'x' });
    for (let i = 0; i < 5; i++) expect((await apple({ sub: 'x', idt: `${h}.${p}.AAAA` })).status).toBe(401);
    expect(keyFetches).toBeLessThanOrEqual(2);
  });

  it('code 교환에서 애플이 다른 사용자 번호를 주면 연결 끊기 토큰을 두지 않는다', async () => {
    const r = await ok(await apple({ sub: nextSub(), e: withKeys, codeSub: 'someone-else' }));
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM apple_tokens WHERE user_id = ?').bind(r.userId).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it('모르는 폰 열쇠로 오면 401', async () => {
    expect((await apple({ sub: nextSub(), token: 'x'.repeat(40) })).status).toBe(401);
  });

  it('애플 비밀값이 없으면 code 교환 없이 로그인만', async () => {
    await ok(await apple({ sub: nextSub() }));
    expect(tokenCalls).toHaveLength(0);
  });

  it('비밀값이 있으면 refresh token을 두고, 계정을 지우면 애플 연결을 끊는다', async () => {
    const r = await ok(await apple({ sub: nextSub(), e: withKeys }));
    expect(tokenCalls[0]!.get('client_id')).toBe('kr.dgo.app');
    expect(tokenCalls[0]!.get('code')).toBe('code-1');
    const secret = tokenCalls[0]!.get('client_secret')!;
    const [h, p] = secret.split('.').slice(0, 2).map((x) => JSON.parse(atob(x.replace(/-/g, '+').replace(/_/g, '/'))));
    expect(h).toMatchObject({ alg: 'ES256', kid: 'KID1' });
    expect(p).toMatchObject({ iss: 'TEAM1', aud: 'https://appleid.apple.com', sub: 'kr.dgo.app' });
    const row = await env.DB.prepare('SELECT refresh_token FROM apple_tokens WHERE user_id = ?').bind(r.userId).first<{ refresh_token: string }>();
    expect(row!.refresh_token).toBe('rt-1');

    expect((await handle(req('DELETE', '/api/me', { token: r.token }), withKeys)).status).toBe(200);
    expect(revokeCalls[0]!.get('token')).toBe('rt-1');
    expect(revokeCalls[0]!.get('token_type_hint')).toBe('refresh_token');
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM apple_tokens WHERE user_id = ?').bind(r.userId).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});
