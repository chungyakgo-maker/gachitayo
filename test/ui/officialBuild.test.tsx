// 정식 빌드 화면 (설계 docs/superpowers/specs/2026-11-18-official-build-design.md, 시안 docs/mock/2026-11-18-official-build.jpg):
// 위치 공유·앞 친구/앞 차 간격을 끄면 그 단추·칸이 "업데이트 예정" 없이 안 보이고, 팀·친구·나머지는 그대로
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { OverlayFrame } from '../../src/ui/overlay/frame';
import type { GroupState } from '../../src/app/group';

const h = vi.hoisted(() => ({
  map: [] as Array<{ frame: OverlayFrame; friend: unknown; friends: unknown[] }>,
  drive: {} as Record<string, unknown>,
  app: true,
  offer: null as unknown,
  mainFriends: [] as unknown[][],
}));
vi.mock('../../src/platform', async (orig) => ({ ...(await orig<typeof import('../../src/platform')>()), isApp: () => h.app }));
vi.mock('../../src/ui/components/MainMap', () => ({
  MainMap: (p: { friends?: unknown[]; children?: unknown }) => {
    h.mainFriends.push(p.friends ?? []);
    return p.children ?? null;
  },
}));
vi.mock('../../src/ui/components/LiveMap', () => ({
  LiveMap: (p: { frame: OverlayFrame; friend?: unknown; friends?: unknown[] }) => {
    h.map.push({ frame: p.frame, friend: p.friend ?? null, friends: p.friends ?? [] });
    return null;
  },
}));
vi.mock('../../src/app/drive', async (orig) => ({
  ...(await orig<typeof import('../../src/app/drive')>()),
  useDrive: () => h.drive,
  getDriveState: () => h.drive,
  loadCourses: async () => [],
}));
vi.mock('../../src/app/recording', async (orig) => ({
  ...(await orig<typeof import('../../src/app/recording')>()),
  useRecording: () => ({ phase: 'recording', sessionId: null, wakeLock: 'active', locationPermission: 'granted', motionPermission: 'granted', gpsError: null, interrupted: [], sessions: [] }),
}));
vi.mock('../../src/ui/hooks/useLocationPreview', () => ({ useLocationPreview: () => ({ fix: { lat: 37.5, lon: 127, hAcc: 5 }, permission: 'granted' }) }));
vi.mock('../../src/app/account', async (orig) => ({
  ...(await orig<typeof import('../../src/app/account')>()),
  useAccount: () => ({ status: 'ready', onboarded: true, userId: 'me', nickname: '세영', kakao: true, apple: false, busy: false, error: null }),
  getAuth: () => ({ userId: 'me', token: 'tok' }),
}));
vi.mock('../../src/app/friends', async (orig) => ({
  ...(await orig<typeof import('../../src/app/friends')>()),
  useFriends: () => ({
    available: true,
    code: 'K7QX29MD',
    friends: [{ userId: 'b', nickname: '민수', since: '', sharing: true, avatar: null, full: false }],
    loaded: true,
    busy: false,
    error: null,
    notice: null,
    sharing: false,
    positions: [{ userId: 'b', nickname: '민수', lat: 37.5, lon: 127, hAcc: 5, heading: null, speed: null, ageMs: 0 }],
  }),
  loadFriends: async () => {},
}));
const ROOM: NonNullable<GroupState['room']> = {
  roomId: 'r1',
  code: '',
  teamId: 't1',
  teamName: '북악 새벽팀',
  members: [
    { userId: 'me', nickname: '세영', color: 0, order: 1, host: true, avatar: null },
    { userId: 'b', nickname: '민수', color: 1, order: 2, host: false, avatar: null },
  ],
  gapS: 2,
  dest: null,
  routeVersion: 0,
};
vi.mock('../../src/app/group', async (orig) => ({
  ...(await orig<typeof import('../../src/app/group')>()),
  useGroup: () => ({ room: ROOM, me: 'me', connected: true, offer: h.offer, later: null, acceptedVersion: 0, error: null }),
}));

const { DriveView } = await import('../../src/ui/screens/DriveScreen');
const { DEFAULT_SETTINGS } = await import('../../src/app/settings');

beforeEach(() => {
  cleanup();
  h.map.length = 0;
  h.mainFriends.length = 0;
  h.app = true;
  h.offer = null;
  h.drive = { phase: 'preparing', replay: null, courses: [], course: null, courseChosen: true, refs: [], ref: null, mode: 'map', error: null, noRecord: false };
  vi.stubEnv('VITE_LOCATION_SHARING', 'off');
});
afterEach(() => vi.unstubAllEnvs());

describe('정식 빌드: 위치 공유·간격 칸이 안 보인다', () => {
  it('주행 준비: "주행 중 위치 공유"·"주행 지도에 친구 위치"·"앞 친구 간격" 없음', async () => {
    const { PrepareScreen } = await import('../../src/ui/screens/PrepareScreen');
    render(<PrepareScreen />);
    expect(screen.getByText('거치 보정')).toBeInTheDocument();
    for (const name of ['위치 공유', '주행 지도에 친구 위치', '앞 친구 간격']) expect(screen.queryByRole('region', { name })).toBeNull();
  });

  it('메인: "위치 공유" 단추 없음, 지도에 친구 없음', async () => {
    h.drive = { phase: 'idle', replay: null, courses: [], course: null, courseChosen: false, refs: [], ref: null, mode: 'map', error: null };
    const { MainScreen } = await import('../../src/ui/screens/MainScreen');
    render(<MainScreen />);
    expect(screen.getByRole('button', { name: /주행 시작/ })).toBeInTheDocument();
    expect(screen.queryByText(/위치 공유/)).toBeNull();
    // 친구 위치가 있어도 지도에 넘기지 않는다
    expect(h.mainFriends.length).toBeGreaterThan(0);
    expect(h.mainFriends.every((f) => f.length === 0)).toBe(true);
  });

  it('주행 화면: 친구·팀원 점과 앞 차 간격을 그리지 않고, 칸 1은 베스트 델타 (저장된 값이 친구 델타여도)', () => {
    const gap = { gapS: 1.2, targetS: 2, deltaS: -0.8, connected: true, title: '앞 차' } as never;
    render(
      <DriveView
        snap={null}
        gap={gap}
        front={{ x: 0, y: 10, label: '민수' } as never}
        friends={[{ x: 5, y: 5, label: '지훈' }]}
        course={null}
        refLap={null}
        mode="map"
        settings={{ ...DEFAULT_SETTINGS, deltaSource: 'friend', widgets: ['gap', 'speed'] }}
        replay={null}
        error={null}
        onCycle={() => {}}
        onEnd={() => {}}
      />,
    );
    const last = h.map.at(-1)!;
    expect(last.frame.gap).toBeNull();
    expect(last.friend).toBeNull();
    expect(last.friends).toEqual([]);
    expect(screen.queryByText(/앞 친구 간격|앞 차/)).toBeNull();
  });

  it('설정: 맨 아래 "정식", 친구 "위치 공유 중" 글자·"주행 지도에 친구 위치" 없음, 안내 글은 팀 주행', async () => {
    const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
    render(<SettingsScreen />);
    expect(screen.getByText(/정식 · 버전/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '주행 지도에 친구 위치' })).toBeNull();
    const friends = screen.getByRole('region', { name: '친구' });
    expect(within(friends).getByText('민수')).toBeInTheDocument();
    expect(within(friends).queryByText(/위치 공유/)).toBeNull();
    expect(within(friends).getByText(/친구와 팀을 만들어 팀 주행을 할 수 있어요/)).toBeInTheDocument();
  });

  it('상단 칸 고르기: "앞 친구 간격" 없음', async () => {
    const { WidgetsScreen } = await import('../../src/ui/screens/WidgetsScreen');
    render(<WidgetsScreen back="#/settings" />);
    expect(screen.queryByText('앞 친구 간격')).toBeNull();
    expect(screen.getAllByText('주행 거리').length).toBeGreaterThan(0);
  });

  it('모의주행: "가상 친구 따라가기" 없음', async () => {
    const { ReplayScreen } = await import('../../src/ui/screens/ReplayScreen');
    render(<ReplayScreen />);
    expect(screen.queryByText('가상 친구 따라가기')).toBeNull();
  });

  it('팀 대기실: "권장 차 간격 (안내)", 순서 줄·목적지·알리기는 그대로', async () => {
    h.drive = { phase: 'idle', replay: null };
    const { GroupScreen } = await import('../../src/ui/screens/GroupScreen');
    render(<GroupScreen />);
    expect(screen.getByText('권장 차 간격 (안내)')).toBeInTheDocument();
    expect(screen.getByText(/모두에게 안내로만 보여요/)).toBeInTheDocument();
    expect(screen.queryByText(/주행 중 지도에 모두 보여요/)).toBeNull();
    expect(screen.getByRole('region', { name: '주행 순서' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /주행 열었어요/ })).toBeInTheDocument();
  });
});

describe('검토 지적', () => {
  it('주행 중 칸을 눌러도 저장된 친구 델타·앞 친구 간격 설정은 지우지 않는다 (다시 켜면 그대로)', async () => {
    const { getSettings, updateSettings } = await import('../../src/app/settings');
    const { fireEvent } = await import('@testing-library/react');
    updateSettings({ ...DEFAULT_SETTINGS, topDelta: true, deltaSource: 'friend', widgets: ['gap', 'speed'] });
    render(<DriveView snap={null} course={null} refLap={null} mode="map" settings={getSettings()} replay={null} error={null} onCycle={() => {}} onEnd={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: /^칸 1/ })[0]!);
    expect(getSettings().deltaSource).toBe('friend');
    expect(getSettings().widgets[0]).toBe('gap');
    updateSettings(DEFAULT_SETTINGS);
  });

  it('방장이 목적지만 보낸 경로: 거리·커브 대신 "각자 지금 위치에서 찾아요"', async () => {
    const { destOnlyRoute } = await import('../../src/app/destOnly');
    h.offer = { version: 1, dest: { name: '팔각정', lat: 37.6, lon: 126.98 }, route: { ...destOnlyRoute({ lat: 37.6, lon: 126.98 }) } };
    const { RouteOfferSheet } = await import('../../src/ui/components/RouteOfferSheet');
    render(<RouteOfferSheet />);
    expect(screen.getByText('팔각정')).toBeInTheDocument();
    expect(screen.getByText(/경로는 각자 지금 위치에서 찾아요/)).toBeInTheDocument();
    expect(screen.queryByText(/커브 \d+개/)).toBeNull();
    expect(screen.getByRole('button', { name: '이 목적지로 진행' })).toBeInTheDocument();
  });

  it('웹에는 "정식/테스트" 표시가 없다 (앱에서만)', async () => {
    h.app = false;
    const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
    render(<SettingsScreen />);
    expect(screen.queryByText(/(정식|테스트) · 버전/)).toBeNull();
    expect(screen.getByText(/^버전 /)).toBeInTheDocument();
  });
});

describe('테스트 빌드(기본)는 그대로', () => {
  it('주행 준비에 "주행 중 위치 공유"가 있고, 설정 맨 아래 "테스트"', async () => {
    vi.unstubAllEnvs();
    const { PrepareScreen } = await import('../../src/ui/screens/PrepareScreen');
    render(<PrepareScreen />);
    expect(screen.getByRole('region', { name: '위치 공유' })).toBeInTheDocument();
    cleanup();
    const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
    render(<SettingsScreen />);
    expect(screen.getByText(/테스트 · 버전/)).toBeInTheDocument();
  });
});
