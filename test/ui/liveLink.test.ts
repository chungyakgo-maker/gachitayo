import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWs {
  static all: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeWs.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

beforeEach(() => {
  FakeWs.all = [];
  localStorage.clear();
  localStorage.setItem('gachitayo.token', 't'.repeat(43));
  localStorage.setItem('gachitayo.userId', '11111111-1111-4111-8111-111111111111');
  vi.stubEnv('VITE_API_URL', 'https://api.example.workers.dev');
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function load() {
  const link = await import('../../src/app/liveLink');
  link.setWebSocketFactoryForTest((url, protocols) => new FakeWs(url, protocols) as unknown as WebSocket);
  const rec = await import('../../src/app/recording');
  return { link, rec };
}

describe('앞 친구 간격 실시간 연결 (M9)', () => {
  it('앞차: 내 방에 열쇠를 하위 프로토콜로 붙고, GPS를 받을 때마다 보낸다', async () => {
    const { link, rec } = await load();
    const emit = rec.__emitSampleForTest;
    link.startLiveLinks({ friend: null, publish: true });
    const ws = FakeWs.all[0]!;
    expect(ws.url).toBe('wss://api.example.workers.dev/live/11111111-1111-4111-8111-111111111111');
    expect(ws.protocols).toEqual(['gachitayo', 't'.repeat(43)]);
    ws.open();
    emit({ kind: 'gps', s: { tRecv: 1000, tFix: 1_800_000_000_000, lat: 37.5, lon: 127, alt: null, altAcc: null, hAcc: 4, speed: 20, heading: 90 } });
    emit({ kind: 'motion', s: { t: 1000, gax: 0, gay: 0, gaz: 9.8, rx: 0, ry: 0, rz: 0 } });
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([{ t: 1_800_000_000_000, lat: 37.5, lon: 127, speed: 20, heading: 90, hAcc: 4 }]);
    link.stopLiveLinks();
    expect(ws.readyState).toBe(3);
  });

  it('뒤차: 앞 친구 방에서 받은 위치를 모으고(늦게 온 것은 버림), 끊기면 다시 붙는다', async () => {
    vi.useFakeTimers();
    const { link } = await load();
    link.startLiveLinks({ friend: { id: '22222222-2222-4222-8222-222222222222', nickname: '지훈' }, publish: false });
    const ws = FakeWs.all[0]!;
    expect(ws.url).toMatch(/\/live\/22222222-2222-4222-8222-222222222222$/);
    ws.open();
    expect(link.getFollowState()).toMatchObject({ nickname: '지훈', connected: true });
    const p = (t: number) => ({ data: JSON.stringify({ t, lat: 37.5, lon: 127, speed: 20, heading: 90, hAcc: 4 }) });
    ws.onmessage!(p(1_800_000_001_000));
    ws.onmessage!(p(1_800_000_002_000));
    ws.onmessage!(p(1_800_000_001_500));
    ws.onmessage!({ data: 'not json' });
    expect(link.getFollowState().points.map((q) => q.t)).toEqual([1_800_000_001_000, 1_800_000_002_000]);
    ws.close();
    expect(link.getFollowState().connected).toBe(false);
    await vi.advanceTimersByTimeAsync(2100);
    expect(FakeWs.all.length).toBe(2);
    link.stopLiveLinks();
    expect(link.getFollowState().friendId).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWs.all.length).toBe(2);
  });

  it('서버 계정이 없으면 붙지 않는다', async () => {
    localStorage.removeItem('gachitayo.token');
    const { link } = await load();
    link.startLiveLinks({ friend: { id: '22222222-2222-4222-8222-222222222222', nickname: '지훈' }, publish: true });
    expect(FakeWs.all.length).toBe(0);
  });
});
