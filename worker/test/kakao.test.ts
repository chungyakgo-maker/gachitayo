// 카카오 로그인 (설계 docs/superpowers/specs/2026-11-13-kakao-login-design.md): 여러 기기 열쇠, 로그아웃, providers,
// 시작·콜백·마치기, 연결·새로 만들기·합치기
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/index';
import { issueToken } from '../src/auth';

const ORIGIN = 'https://example.github.io';
const BASE = 'https://api.example.workers.dev';
let ipSeq = 0;

function req(method: string, path: string, init: { token?: string; body?: object | string; origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
  headers['CF-Connecting-IP'] = init.ip ?? `10.1.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  let body: string | undefined;
  if (init.body !== undefined) {
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
