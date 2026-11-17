// 아이폰 앱 로그인 (앱 로그인 설계 docs/superpowers/specs/2026-11-17-app-login-design.md):
// 카카오는 iOS 로그인 창으로 열고 dgo://auth/kakao 로 돌아오며, 애플은 nonce 해시만 애플 창에 주고 원래 값을 서버로
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'https://gachitayo-api.example.workers.dev';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const h = vi.hoisted(() => ({
  web: vi.fn(async (_o: { url: string; scheme: string }) => ({}) as { url?: string; cancelled?: boolean }),
  apple: vi.fn(async (_o: { nonce: string }) => ({}) as { identityToken?: string; authorizationCode?: string; name?: string; cancelled?: boolean }),
}));
vi.mock('../../src/platform', async (orig) => ({ ...(await orig<typeof import('../../src/platform')>()), isApp: () => true }));
vi.mock('../../src/app/nativeAuth', () => ({ DgoAuth: { webAuth: (o: { url: string; scheme: string }) => h.web(o), appleSignIn: (o: { nonce: string }) => h.apple(o) } }));

let fetchMock: ReturnType<typeof vi.fn>;
async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const STATE = 'S'.repeat(32);
const body = (i: number) => JSON.parse(String((fetchMock.mock.calls[i]![1] as RequestInit).body));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubEnv('VITE_API_URL', API);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  h.web.mockReset();
  h.apple.mockReset();
  window.location.hash = '#/';
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('카카오 로그인 (아이폰 앱)', () => {
  it('앱 주소로 돌아오게 시작하고, iOS 로그인 창이 돌려준 state·번호를 마치기 화면으로 넘긴다', async () => {
    const k = await import('../../src/app/kakaoLogin');
    fetchMock.mockResolvedValueOnce(json(200, { url: `https://kauth.kakao.com/oauth/authorize?state=${STATE}` }));
    h.web.mockResolvedValueOnce({ url: `dgo://auth/kakao?state=${STATE}&pin=123456` });
    await k.startKakaoLogin('#/settings');
    expect(body(0).returnTo).toBe('dgo://auth/kakao');
    expect(h.web).toHaveBeenCalledWith({ url: `https://kauth.kakao.com/oauth/authorize?state=${STATE}`, scheme: 'dgo' });
    expect(window.location.hash).toBe(`#/auth/kakao?state=${STATE}&pin=123456`);
    expect(k.pendingKakaoLogin()).toMatchObject({ state: STATE, from: '#/settings' });
  });

  it('로그인 창을 닫으면 진행 중 로그인을 지운다', async () => {
    const k = await import('../../src/app/kakaoLogin');
    fetchMock.mockResolvedValueOnce(json(200, { url: `https://kauth.kakao.com/oauth/authorize?state=${STATE}` }));
    h.web.mockResolvedValueOnce({ cancelled: true });
    await k.startKakaoLogin('#/');
    expect(k.pendingKakaoLogin()).toBeNull();
    expect(window.location.hash).toBe('#/');
  });

  it('앱에서는 애플 로그인도 켜진다 (서버가 apple: true)', async () => {
    const k = await import('../../src/app/kakaoLogin');
    fetchMock.mockResolvedValueOnce(json(200, { kakao: true, apple: true }));
    expect(await k.getProviders()).toEqual({ kakao: true, apple: true });
  });
});

describe('애플 로그인 (아이폰 앱)', () => {
  it('nonce 해시만 애플 창에 주고, 원래 값·토큰·이름을 지금 열쇠와 함께 서버로 보낸 뒤 그 계정을 쓴다', async () => {
    localStorage.setItem('gachitayo.token', 't'.repeat(43));
    localStorage.setItem('gachitayo.userId', 'u1');
    localStorage.setItem('gachitayo.onboarded', '1');
    const ap = await import('../../src/app/appleLogin');
    const acc = await import('../../src/app/account');
    const after = vi.fn();
    ap.setAfterAppleLogin(after);
    h.apple.mockResolvedValueOnce({ identityToken: 'id.tok.en', authorizationCode: 'code-1', name: '홍길동' });
    fetchMock.mockResolvedValueOnce(json(200, { userId: 'u1', token: 'n'.repeat(43), nickname: '민수', kind: 'linked' }));
    fetchMock.mockResolvedValueOnce(json(200, { userId: 'u1', nickname: '민수', kakao: false, apple: true }));
    const r = await ap.startAppleLogin();
    expect(r).toEqual({ ok: true, kind: 'linked' });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${API}/auth/apple`);
    expect(new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers).get('Authorization')).toBe(`Bearer ${'t'.repeat(43)}`);
    const b = body(0);
    expect(b).toMatchObject({ identityToken: 'id.tok.en', authorizationCode: 'code-1', nickname: '홍길동' });
    expect(h.apple.mock.calls[0]![0].nonce).toBe(await sha256Hex(b.nonce));
    expect(acc.getAccountState()).toMatchObject({ status: 'ready', userId: 'u1', apple: true, onboarded: true });
    expect(localStorage.getItem('gachitayo.token')).toBe('n'.repeat(43));
    expect(after).toHaveBeenCalled();
  });

  it('애플 창을 닫으면 아무것도 바뀌지 않는다', async () => {
    const ap = await import('../../src/app/appleLogin');
    h.apple.mockResolvedValueOnce({ cancelled: true });
    expect(await ap.startAppleLogin()).toEqual({ ok: false, cancelled: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('서버가 확인하지 못하면(401) 알려 주고 계정은 그대로', async () => {
    const ap = await import('../../src/app/appleLogin');
    const acc = await import('../../src/app/account');
    h.apple.mockResolvedValueOnce({ identityToken: 'id.tok.en', authorizationCode: '' });
    fetchMock.mockResolvedValueOnce(json(401, { error: 'x' }));
    expect(await ap.startAppleLogin()).toEqual({ ok: false, error: '애플 로그인을 확인하지 못했어요. 다시 시도해 주세요' });
    expect(acc.getAccountState().apple).toBe(false);
  });
});
