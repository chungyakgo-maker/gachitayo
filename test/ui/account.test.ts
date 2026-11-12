import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Account = typeof import('../../src/app/account');

const API = 'https://gachitayo-api.example.workers.dev';
let fetchMock: ReturnType<typeof vi.fn>;

async function load(): Promise<Account> {
  vi.resetModules();
  return import('../../src/app/account');
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_API_URL', API);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('익명 계정 (같이타요 API)', () => {
  it('첫 실행: 닉네임으로 가입하고 폰 열쇠를 폰에 보관한다', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { userId: 'u1', token: 't'.repeat(43) }));
    const a = await load();
    expect(a.getAccountState().status).toBe('none');
    expect(await a.finishOnboarding(' 민수 ')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API}/auth/signup`);
    expect(JSON.parse(init.body)).toEqual({ nickname: '민수' });
    expect(a.getAccountState()).toMatchObject({ status: 'ready', userId: 'u1', nickname: '민수', onboarded: true });
    expect(a.getAuth()).toEqual({ userId: 'u1', token: 't'.repeat(43) });
    expect(localStorage.getItem('gachitayo.token')).toBe('t'.repeat(43));
  });

  it('다시 열면 열쇠를 확인하고, 서버가 모르면(401) 계정 끊김으로 본다', async () => {
    localStorage.setItem('gachitayo.token', 'old');
    localStorage.setItem('gachitayo.userId', 'u1');
    localStorage.setItem('gachitayo.onboarded', '1');
    fetchMock.mockResolvedValueOnce(json(401, { error: '로그인 필요' }));
    const a = await load();
    expect(a.getAccountState().status).toBe('ready');
    await a.initAccount();
    expect(a.getAccountState().status).toBe('none');
    expect(a.getAuth()).toBeNull();
    expect(localStorage.getItem('gachitayo.token')).toBeNull();
  });

  it('통신이 없으면 계정을 그대로 둔다', async () => {
    localStorage.setItem('gachitayo.token', 'old');
    localStorage.setItem('gachitayo.userId', 'u1');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const a = await load();
    await a.initAccount();
    expect(a.getAccountState().status).toBe('ready');
  });

  it('가입 실패는 알기 쉬운 말로 (통신 없음, 가입 제한, 서버 오류)', async () => {
    const a = await load();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await a.finishOnboarding('민수')).toBe(false);
    expect(a.getAccountState().error).toMatch(/연결할 수 없어요/);
    fetchMock.mockResolvedValueOnce(json(429, { error: '잠시 뒤' }));
    await a.finishOnboarding('민수');
    expect(a.getAccountState().error).toMatch(/잠시 뒤 다시/);
    fetchMock.mockResolvedValueOnce(json(500, { error: 'x' }));
    await a.finishOnboarding('민수');
    expect(a.getAccountState().error).toMatch(/서버에 문제/);
    expect(a.getAccountState().onboarded).toBe(false);
  });

  it('서버 연결 전에 첫 실행을 마쳤으면, 서버가 생긴 뒤 시작할 때 저장된 닉네임으로 계정을 자동으로 만든다', async () => {
    localStorage.setItem('gachitayo.onboarded', '1');
    localStorage.setItem('gachitayo.nickname', '민수');
    fetchMock.mockResolvedValueOnce(json(201, { userId: 'u2', token: 'k'.repeat(43) }));
    const a = await load();
    expect(a.getAccountState()).toMatchObject({ status: 'none', lost: false });
    await a.initAccount();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API}/auth/signup`);
    expect(JSON.parse(init.body)).toEqual({ nickname: '민수' });
    expect(a.getAccountState()).toMatchObject({ status: 'ready', userId: 'u2', lost: false, error: null });
  });

  it('자동 계정 만들기가 통신 없어 실패하면 조용히 두고 다음 기회에 다시 한다', async () => {
    localStorage.setItem('gachitayo.onboarded', '1');
    localStorage.setItem('gachitayo.nickname', '민수');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const a = await load();
    await a.initAccount();
    expect(a.getAccountState()).toMatchObject({ status: 'none', lost: false, error: null, busy: false });
    fetchMock.mockResolvedValueOnce(json(201, { userId: 'u3', token: 'k'.repeat(43) }));
    await a.ensureAccount();
    expect(a.getAccountState()).toMatchObject({ status: 'ready', userId: 'u3' });
  });

  it('끊긴 계정은 자동으로 새로 만들지 않는다 (사용자가 설정에서 고른다)', async () => {
    localStorage.setItem('gachitayo.token', 'old');
    localStorage.setItem('gachitayo.userId', 'u1');
    localStorage.setItem('gachitayo.onboarded', '1');
    fetchMock.mockResolvedValueOnce(json(401, { error: '로그인 필요' }));
    const a = await load();
    await a.initAccount();
    expect(a.getAccountState()).toMatchObject({ status: 'none', lost: true });
    await a.ensureAccount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 다시 열어도 끊김으로 남는다
    const b = await load();
    expect(b.getAccountState()).toMatchObject({ status: 'none', lost: true });
  });

  it('첫 실행 전이면 자동으로 만들지 않는다', async () => {
    const a = await load();
    await a.initAccount();
    await a.ensureAccount();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('서버 주소가 없으면 계정 없이 폰에만 (가입 요청을 보내지 않는다)', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const a = await load();
    expect(a.getAccountState().status).toBe('disabled');
    expect(await a.finishOnboarding('민수')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
