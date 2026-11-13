import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 카카오 로그인 (설계 5.2·5.6): 시작은 verifier 해시만 보내고, 마치기는 같은 창의 verifier + 번호로
type Kakao = typeof import('../../src/app/kakaoLogin');
type Account = typeof import('../../src/app/account');

const API = 'https://gachitayo-api.example.workers.dev';
let fetchMock: ReturnType<typeof vi.fn>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function load(): Promise<{ k: Kakao; a: Account }> {
  vi.resetModules();
  const k = await import('../../src/app/kakaoLogin');
  const a = await import('../../src/app/account');
  return { k, a };
}
async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const STATE = 'S'.repeat(32);

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_API_URL', API);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('카카오 로그인 시작·마치기 (앱)', () => {
  it('시작: verifier는 폰에 두고 해시만 보내며, 카카오 주소로 이동한다', async () => {
    const { k } = await load();
    const go = vi.fn();
    k.kakaoNav.go = go;
    fetchMock.mockResolvedValueOnce(json(200, { url: `https://kauth.kakao.com/oauth/authorize?client_id=x&state=${STATE}` }));
    await k.startKakaoLogin('#/settings');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API}/auth/kakao/start`);
    const body = JSON.parse(init.body) as { returnTo: string; verifierHash: string };
    const saved = JSON.parse(localStorage.getItem('gachitayo.kakaoLogin')!) as { state: string; verifier: string; from: string };
    expect(saved.state).toBe(STATE);
    expect(saved.from).toBe('#/settings');
    expect(body.verifierHash).toBe(await sha256Hex(saved.verifier));
    expect(init.body).not.toContain(saved.verifier);
    expect(body.returnTo).toBe(`${location.origin}${location.pathname}`);
    expect(go).toHaveBeenCalledWith(`https://kauth.kakao.com/oauth/authorize?client_id=x&state=${STATE}`);
    expect(k.pendingKakaoLogin()).toMatchObject({ state: STATE, from: '#/settings' });
  });

  it('마치기: 새 열쇠를 받아 계정으로 쓰고, 카카오 연결로 표시한다', async () => {
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/', startedAt: Date.now() }));
    const { k, a } = await load();
    const after = vi.fn();
    k.setAfterKakaoLogin(after);
    fetchMock.mockResolvedValueOnce(json(200, { userId: 'u9', token: 'n'.repeat(43), nickname: '드리프트왕', kind: 'created' }));
    const r = await k.finishKakaoLogin(STATE, '123456');
    expect(r).toEqual({ ok: true, kind: 'created' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ state: STATE, verifier: 'v'.repeat(43), pin: '123456' });
    expect(a.getAuth()).toEqual({ userId: 'u9', token: 'n'.repeat(43) });
    expect(a.getAccountState()).toMatchObject({ status: 'ready', kakao: true, onboarded: true, nickname: '드리프트왕', lost: false });
    expect(localStorage.getItem('gachitayo.kakao')).toBe('1');
    expect(k.pendingKakaoLogin()).toBeNull();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('이 창에서 시작하지 않은 state면 서버에 묻지 않고 거절한다', async () => {
    const { k } = await load();
    const r = await k.finishKakaoLogin(STATE, '123456');
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('진행 중 표시는 10분 뒤 사라지고, 취소하면 바로 사라진다', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/', startedAt: 1_000_000 }));
    const { k } = await load();
    expect(k.pendingKakaoLogin()).not.toBeNull();
    vi.setSystemTime(1_000_000 + 10 * 60_000 + 1000);
    expect(k.pendingKakaoLogin()).toBeNull();
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/', startedAt: Date.now() }));
    expect(k.pendingKakaoLogin()).not.toBeNull();
    k.cancelKakaoLogin();
    expect(k.pendingKakaoLogin()).toBeNull();
  });

  it('번호가 틀리면(403) 진행 중 표시를 남기고 알려 준다. 시간이 지났으면(410) 지운다', async () => {
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/', startedAt: Date.now() }));
    const { k } = await load();
    fetchMock.mockResolvedValueOnce(json(403, { error: '번호가 맞지 않아요' }));
    expect(await k.finishKakaoLogin(STATE, '000000')).toEqual({ ok: false, error: '번호가 맞지 않아요' });
    expect(k.pendingKakaoLogin()).not.toBeNull();
    fetchMock.mockResolvedValueOnce(json(410, { error: '만료' }));
    const r = await k.finishKakaoLogin(STATE, '000000');
    expect(r.ok).toBe(false);
    expect(k.pendingKakaoLogin()).toBeNull();
  });

  it('같은 state로 동시에 두 번 마쳐도 서버에는 한 번만 묻는다', async () => {
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/', startedAt: Date.now() }));
    const { k } = await load();
    fetchMock.mockResolvedValueOnce(json(200, { userId: 'u9', token: 'n'.repeat(43), nickname: 'x', kind: 'login' }));
    const [r1, r2] = await Promise.all([k.finishKakaoLogin(STATE, '123456'), k.finishKakaoLogin(STATE, '123456')]);
    expect(r1).toEqual(r2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('마치는 중에 받은 401은 계정 끊김으로 보지 않는다', async () => {
    localStorage.setItem('gachitayo.token', 'old'.repeat(10));
    localStorage.setItem('gachitayo.userId', 'u1');
    localStorage.setItem('gachitayo.onboarded', '1');
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/', startedAt: Date.now() }));
    const { k, a } = await load();
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((res) => (release = res)));
    const p = k.finishKakaoLogin(STATE, '123456');
    a.markAccountLost();
    expect(a.getAccountState().lost).toBe(false);
    release(json(200, { userId: 'u1', token: 'n'.repeat(43), nickname: 'x', kind: 'linked' }));
    await p;
    expect(a.getAccountState()).toMatchObject({ status: 'ready', lost: false });
  });

  it('주소로 돌아왔을 때(같은 창) 계정 확인보다 먼저 마친다', async () => {
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/', startedAt: Date.now() }));
    const { k, a } = await load();
    fetchMock.mockResolvedValueOnce(json(200, { userId: 'u9', token: 'n'.repeat(43), nickname: 'x', kind: 'created' }));
    await k.finishFromHash(`#/auth/kakao?state=${STATE}&pin=123456`);
    expect(a.getAuth()?.userId).toBe('u9');
    fetchMock.mockClear();
    await k.finishFromHash('#/settings');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('providers: 서버가 카카오를 켜 두었는지. 실패하면 false', async () => {
    const { k } = await load();
    fetchMock.mockResolvedValueOnce(json(200, { kakao: true }));
    expect(await k.getProviders()).toEqual({ kakao: true });
    const { k: k2 } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await k2.getProviders()).toEqual({ kakao: false });
  });

  it('/api/me의 kakao를 폰에 반영한다', async () => {
    localStorage.setItem('gachitayo.token', 't'.repeat(43));
    localStorage.setItem('gachitayo.userId', 'u1');
    localStorage.setItem('gachitayo.onboarded', '1');
    const { a } = await load();
    fetchMock.mockResolvedValueOnce(json(200, { userId: 'u1', nickname: '민수', kakao: true }));
    await a.initAccount();
    expect(a.getAccountState().kakao).toBe(true);
    expect(localStorage.getItem('gachitayo.kakao')).toBe('1');
  });
});
