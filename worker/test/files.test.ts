// 파일 게이트웨이 테스트 (사양서 10.1): 실제 Workers 런타임에서 돌고, R2는 메모리 버킷이다.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { handle, MAX_FILE_BYTES, type Deps } from '../src/index';
import { resetJwksCache } from '../src/jwt';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const ORIGIN = 'https://example.github.io';
const ISSUER = 'https://test-project.supabase.co/auth/v1';
const BASE = 'https://files.example.workers.dev';
const enc = new TextEncoder();

const b64url = (bytes: Uint8Array | ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const part = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));

let ecKey: CryptoKeyPair;
let ecJwk: JsonWebKey & { kid: string; alg: string };
let jwksCalls = 0;

beforeAll(async () => {
  ecKey = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  ecJwk = { ...((await crypto.subtle.exportKey('jwk', ecKey.publicKey)) as JsonWebKey), kid: 'k1', alg: 'ES256' };
});

const claims = (p: Record<string, unknown> = {}) => ({
  sub: USER,
  iss: ISSUER,
  aud: 'authenticated',
  role: 'authenticated',
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...p,
});

async function es256(payload: Record<string, unknown>, kid = 'k1', key = ecKey.privateKey): Promise<string> {
  const input = `${part({ alg: 'ES256', typ: 'JWT', kid })}.${part(payload)}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input));
  return `${input}.${b64url(sig)}`;
}

async function hs256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const input = `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${input}.${b64url(await crypto.subtle.sign('HMAC', key, enc.encode(input)))}`;
}

const deps = (): Deps => ({
  fetchJwks: async () => {
    jwksCalls++;
    return { keys: [ecJwk] };
  },
});

function req(method: string, path: string, init: { token?: string; body?: BodyInit; origin?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
  return new Request(`${BASE}${path}`, { method, headers, body: init.body });
}
const filePath = (user = USER, session = SESSION, kind = 'raw') => `/files/${user}/${session}.${kind}.json.gz`;

describe('파일 게이트웨이 (사양서 6.6, 10.1)', () => {
  it('사전 요청(OPTIONS): 허용한 출처면 204와 CORS 헤더', async () => {
    const r = await handle(req('OPTIONS', filePath(), { headers: { 'Access-Control-Request-Method': 'PUT' } }), env, deps());
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('허용하지 않은 출처는 막는다 (CORS 헤더 없이 403)', async () => {
    const token = await es256(claims());
    for (const method of ['OPTIONS', 'GET']) {
      const r = await handle(req(method, filePath(), { token, origin: 'https://evil.example.com' }), env, deps());
      expect(r.status).toBe(403);
      expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('토큰 없음·잘못된 서명·만료·다른 발급자 → 401', async () => {
    expect((await handle(req('GET', filePath()), env, deps())).status).toBe(401);
    const other = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const bad = [
      await es256(claims(), 'k1', other.privateKey),
      await es256(claims({ exp: Math.floor(Date.now() / 1000) - 10 })),
      await es256(claims({ iss: 'https://other.supabase.co/auth/v1' })),
      'not.a.token',
    ];
    for (const token of bad) {
      const r = await handle(req('GET', filePath(), { token }), env, deps());
      expect(r.status, token.slice(0, 20)).toBe(401);
      // 오류 응답에도 CORS 헤더가 있어야 웹앱이 상태 코드를 읽을 수 있다
      expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    }
  });

  it('다른 사용자 폴더 → 403', async () => {
    const token = await es256(claims());
    const r = await handle(req('PUT', filePath(OTHER), { token, body: new Uint8Array([1, 2, 3]) }), env, deps());
    expect(r.status).toBe(403);
  });

  it('잘못된 경로 → 400 (UUID 아님, 종류가 raw/processed 아님, 확장자, 경로 더 붙음)', async () => {
    const token = await es256(claims());
    for (const p of [
      `/files/${USER}/not-a-uuid.raw.json.gz`,
      `/files/abc/${SESSION}.raw.json.gz`,
      filePath(USER, SESSION, 'other'),
      `/files/${USER}/${SESSION}.raw.json`,
      `/files/${USER}/${SESSION}.raw.json.gz/x`,
      `/files/${USER}/../${SESSION}.raw.json.gz`,
      '/',
    ]) {
      const r = await handle(req('GET', p, { token }), env, deps());
      expect(r.status, p).toBe(400);
    }
  });

  it('20 MB 넘는 파일 → 413', async () => {
    const token = await es256(claims());
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    const r = await handle(req('PUT', filePath(), { token, body: big }), env, deps());
    expect(r.status).toBe(413);
    // 길이를 밝히지 않은 스트림도
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 21; i++) c.enqueue(new Uint8Array(1024 * 1024));
        c.close();
      },
    });
    const r2 = await handle(req('PUT', filePath(USER, SESSION, 'processed'), { token, body: stream }), env, deps());
    expect(r2.status).toBe(413);
    expect(await env.SESSION_FILES.head(`${USER}/${SESSION}.processed.json.gz`)).toBeNull();
  });

  it('올린 뒤 HEAD(크기)와 GET(내용)이 올린 파일과 같다. 같은 키는 덮어쓴다', async () => {
    const token = await es256(claims());
    const body = crypto.getRandomValues(new Uint8Array(5000));
    const put = await handle(req('PUT', filePath(), { token, body }), env, deps());
    expect(put.status).toBe(201);
    const head = await handle(req('HEAD', filePath(), { token }), env, deps());
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('5000');
    expect(head.headers.get('Access-Control-Expose-Headers')).toContain('Content-Length');
    const get = await handle(req('GET', filePath(), { token }), env, deps());
    expect(get.status).toBe(200);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);
    // 덮어쓰기
    const body2 = new Uint8Array([9, 9, 9]);
    expect((await handle(req('PUT', filePath(), { token, body: body2 }), env, deps())).status).toBe(201);
    expect(new Uint8Array(await (await handle(req('GET', filePath(), { token }), env, deps())).arrayBuffer())).toEqual(body2);
  });

  it('없는 파일 → 404, 허용하지 않는 메서드 → 405', async () => {
    const token = await es256(claims());
    expect((await handle(req('GET', filePath(USER, SESSION, 'processed'), { token }), env, deps())).status).toBe(404);
    expect((await handle(req('HEAD', filePath(USER, SESSION, 'processed'), { token }), env, deps())).status).toBe(404);
    expect((await handle(req('DELETE', filePath(), { token }), env, deps())).status).toBe(405);
  });

  it('예전 방식(대칭 키 HS256): 비밀값을 등록했을 때만 받는다', async () => {
    const token = await hs256(claims(), 'legacy-secret');
    expect((await handle(req('HEAD', filePath(), { token }), { ...env, SUPABASE_JWT_SECRET: 'legacy-secret' }, deps())).status).not.toBe(401);
    expect((await handle(req('HEAD', filePath(), { token }), { ...env, SUPABASE_JWT_SECRET: 'wrong' }, deps())).status).toBe(401);
    expect((await handle(req('HEAD', filePath(), { token }), env, deps())).status).toBe(401);
  });

  it('JWKS는 캐시하고, 모르는 키 ID가 오면 한 번 다시 받는다 (키 교체)', async () => {
    resetJwksCache();
    jwksCalls = 0;
    const token = await es256(claims());
    await handle(req('HEAD', filePath(), { token }), env, deps());
    await handle(req('HEAD', filePath(), { token }), env, deps());
    expect(jwksCalls).toBe(1);
    const unknownKid = await es256(claims(), 'k2');
    expect((await handle(req('HEAD', filePath(), { token: unknownKid }), env, deps())).status).toBe(401);
    expect(jwksCalls).toBe(2);
  });
});
