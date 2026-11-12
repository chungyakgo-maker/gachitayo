import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Friends = typeof import('../../src/app/friends');
const API = 'https://gachitayo-api.example.workers.dev';
let fetchMock: ReturnType<typeof vi.fn>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function load(): Promise<Friends> {
  vi.resetModules();
  const f = await import('../../src/app/friends');
  f.resetFriendsForTest();
  return f;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gachitayo.token', 't'.repeat(43));
  localStorage.setItem('gachitayo.userId', 'u1');
  localStorage.setItem('gachitayo.onboarded', '1');
  vi.stubEnv('VITE_API_URL', API);
  fetchMock = vi.fn(async () => json(200, { ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const calls = () => fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit).method} ${String(url).replace(API, '')}`);

describe('친구 (사양서 8.8, M8)', () => {
  it('친구 코드·목록을 받아 오고, 코드는 K7P2-Q9XM 모양으로 보여준다', async () => {
    const f = await load();
    fetchMock.mockResolvedValueOnce(json(200, { code: 'K7P2Q9XM', friends: [{ userId: 'u2', nickname: '지훈', since: 'x', sharing: true }] }));
    await f.loadFriends();
    expect(f.getFriendsState()).toMatchObject({ available: true, code: 'K7P2Q9XM', loaded: true });
    expect(f.getFriendsState().friends[0]!.nickname).toBe('지훈');
    expect(f.formatCode('K7P2Q9XM')).toBe('K7P2-Q9XM');
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${'t'.repeat(43)}` });
  });

  it('친구 코드 넣기: 하이픈·소문자는 다듬어 보내고, 성공·없는 코드를 알려 준다', async () => {
    const f = await load();
    fetchMock.mockResolvedValueOnce(json(200, { userId: 'u2', nickname: '지훈', already: false }));
    fetchMock.mockResolvedValueOnce(json(200, { code: 'AAAABBBB', friends: [] }));
    expect(await f.addFriendByCode(' k7p2-q9xm ')).toBe(true);
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ code: 'K7P2Q9XM' });
    expect(f.getFriendsState().notice).toBe('지훈 님과 친구가 됐어요');
    fetchMock.mockResolvedValueOnce(json(404, { error: '친구 코드를 찾을 수 없어요' }));
    expect(await f.addFriendByCode('ZZZZZZZZ')).toBe(false);
    expect(f.getFriendsState().error).toBe('친구 코드를 찾을 수 없어요');
    expect(await f.addFriendByCode('123')).toBe(false);
    expect(f.getFriendsState().error).toMatch(/8자리/);
  });

  it('위치 공유: 켠 동안 5초마다 내 위치를 보내고, 화면이 가려지거나 위치가 오래되면 보내지 않고, 끄면 지운다', async () => {
    vi.useFakeTimers();
    const f = await load();
    let push: ((fix: import('../../src/app/friends').MyFix) => void) | null = null;
    const stop = vi.fn();
    f.setGpsStarterForTest((onFix) => {
      push = onFix;
      return stop;
    });
    await f.setSharing(true);
    expect(calls()).toEqual([]); // 아직 위치 없음
    push!({ lat: 37.5, lon: 127, hAcc: 6.04, heading: 90, speed: 12, at: Date.now() });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls()).toEqual(['PUT /api/presence']);
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ lat: 37.5, lon: 127, hAcc: 6, heading: 90, speed: 12 });
    // 화면이 가려지면 보내지 않는다
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    push!({ lat: 37.5, lon: 127, hAcc: 6, at: Date.now() });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls().length).toBe(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    // 위치가 30초 넘게 안 들어오면 보내지 않는다
    await vi.advanceTimersByTimeAsync(35_000);
    const n = calls().length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls().length).toBe(n);
    await f.setSharing(false);
    expect(calls().at(-1)).toBe('DELETE /api/presence');
    expect(stop).toHaveBeenCalled();
    expect(f.getFriendsState().sharing).toBe(false);
  });

  it('친구 위치는 지켜보는 동안 5초마다 받아 오고, 그만 보면 멈춘다', async () => {
    vi.useFakeTimers();
    const f = await load();
    fetchMock.mockImplementation(async () => json(200, [{ userId: 'u2', nickname: '지훈', lat: 37.5, lon: 127, hAcc: 5, heading: null, speed: null, ageMs: 1200 }]));
    const stop = f.watchFriendPositions();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.getFriendsState().positions[0]!.nickname).toBe('지훈');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls().filter((c) => c === 'GET /api/friends/presence').length).toBe(3);
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls().length).toBe(3);
  });

  it('서버 계정이 없으면 친구 기능을 쓸 수 없다고 알린다', async () => {
    localStorage.removeItem('gachitayo.token');
    const f = await load();
    await f.loadFriends();
    expect(f.getFriendsState().available).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
