// @vitest-environment jsdom
// 정식 빌드 스위치 (설계 docs/superpowers/specs/2026-11-18-official-build-design.md, 세영 "정식버전엔 위치공유를 빼고 추후 재활성화"):
// 끄면 다른 사람과 위치를 주고받는 요청이 하나도 없다. 켜면(기본) 지금과 같다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'https://api.example.workers.dev';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;

class FakeWs {
  static all: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWs.all.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {}
}

beforeEach(() => {
  vi.resetModules();
  FakeWs.all = [];
  localStorage.clear();
  localStorage.setItem('gachitayo.token', 't'.repeat(43));
  localStorage.setItem('gachitayo.userId', '11111111-1111-4111-8111-111111111111');
  localStorage.setItem('gachitayo.onboarded', '1');
  vi.stubEnv('VITE_API_URL', API);
  fetchMock = vi.fn(async () => json(200, { ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('스위치', () => {
  it('기본은 켬 (테스트 빌드 = 지금 그대로)', async () => {
    const f = await import('../../src/features');
    expect(f.locationSharing()).toBe(true);
    expect(f.liveGap()).toBe(true);
    expect(f.buildChannel()).toBe('테스트');
  });

  it('VITE_LOCATION_SHARING=off 이면 위치 공유도 간격도 끔 (정식)', async () => {
    vi.stubEnv('VITE_LOCATION_SHARING', 'off');
    const f = await import('../../src/features');
    expect(f.locationSharing()).toBe(false);
    expect(f.liveGap()).toBe(false);
    expect(f.buildChannel()).toBe('정식');
  });

  it('간격만 따로 켤 수 있다 (나중에 센터 답에 따라)', async () => {
    vi.stubEnv('VITE_LOCATION_SHARING', 'off');
    vi.stubEnv('VITE_LIVE_GAP', 'on');
    const f = await import('../../src/features');
    expect(f.locationSharing()).toBe(false);
    expect(f.liveGap()).toBe(true);
  });
});

describe('스위치 값이 틀리면 끈다 (검토 지적: 오타로 정식 빌드가 위치를 공유하지 않게)', () => {
  for (const v of ['OFF', 'false', '0', 'of', '']) {
    it(`VITE_LOCATION_SHARING='${v}' → 끔`, async () => {
      vi.stubEnv('VITE_LOCATION_SHARING', v);
      const f = await import('../../src/features');
      expect(f.locationSharing()).toBe(false);
      expect(f.liveGap()).toBe(false);
    });
  }
  it("VITE_LIVE_GAP 오타도 끔, 'on' 만 켬", async () => {
    vi.stubEnv('VITE_LIVE_GAP', 'yes');
    const f = await import('../../src/features');
    expect(f.locationSharing()).toBe(true);
    expect(f.liveGap()).toBe(false);
  });
});

describe('정식: 위치를 보내지도 받지도 않는다', () => {
  beforeEach(() => vi.stubEnv('VITE_LOCATION_SHARING', 'off'));

  it('위치 공유를 켤 수 없고 서버에 아무것도 안 보낸다', async () => {
    const fr = await import('../../src/app/friends');
    fr.resetFriendsForTest();
    fr.setGpsStarterForTest(() => () => {});
    await fr.setSharing(true);
    expect(fr.getFriendsState().sharing).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('친구 위치를 받아 오지 않는다', async () => {
    const fr = await import('../../src/app/friends');
    fr.resetFriendsForTest();
    const stop = fr.watchFriendPositions();
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('앞 친구 실시간 연결을 열지 않는다 (앞 친구를 골라 둔 채 주행을 시작해도)', async () => {
    const link = await import('../../src/app/liveLink');
    link.setWebSocketFactoryForTest((url) => new FakeWs(url) as unknown as WebSocket);
    link.startLiveLinks({ friend: { id: '22222222-2222-4222-8222-222222222222', nickname: '민수' }, publish: true });
    expect(FakeWs.all).toEqual([]);
    expect(link.getFollowState().friendId).toBeNull();
  });

  it('저장된 칸 설정은 지우지 않고 읽을 때만: 친구 델타 → 베스트 델타, 앞 친구 간격 → 표시 안 함', async () => {
    const s = await import('../../src/app/settings');
    const base = s.getSettings();
    expect(s.effectiveSettings({ ...base, deltaSource: 'friend', widgets: ['gap', 'speed'] })).toMatchObject({ deltaSource: 'best', widgets: ['none', 'speed'] });
  });
});

describe('기본(켬)은 그대로', () => {
  it('칸 설정을 바꾸지 않는다', async () => {
    const s = await import('../../src/app/settings');
    const v = { ...s.getSettings(), deltaSource: 'friend' as const, widgets: ['gap', 'speed'] as ['gap', 'speed'] };
    expect(s.effectiveSettings(v)).toBe(v);
  });
});
