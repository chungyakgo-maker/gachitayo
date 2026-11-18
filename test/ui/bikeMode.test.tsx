// 바이크 모드 화면 (2026-11-18 세영 승인 시안 docs/mock/2026-11-18-bike-mode.jpg):
// 탈것(자동차·바이크), 내 바이크 표시 5종, 바이크 경로(고속도로·자동차전용도로 피함)
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const { DEFAULT_SETTINGS, getSettings, updateSettings } = await import('../../src/app/settings');

beforeEach(() => {
  cleanup();
  h.map.length = 0;
  h.mainFriends.length = 0;
  h.app = true;
  h.offer = null;
  h.drive = { phase: 'preparing', replay: null, courses: [], course: null, courseChosen: true, refs: [], ref: null, mode: 'map', error: null, noRecord: false };
  updateSettings(DEFAULT_SETTINGS);
});

describe('주행 준비: 탈것', () => {
  it('지금 탈것을 보여 주고 여기서도 바꿀 수 있다 (바이크면 고른 바이크 이름)', async () => {
    const { PrepareScreen } = await import('../../src/ui/screens/PrepareScreen');
    render(<PrepareScreen />);
    const sec = screen.getByRole('region', { name: '탈것' });
    expect(within(sec).getByRole('button', { name: '자동차' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(sec).getByRole('button', { name: '바이크' }));
    expect(getSettings().vehicle).toBe('bike');
    expect(within(sec).getByText(/R차 · 길찾기는 고속도로·자동차전용도로를 피해요/)).toBeInTheDocument();
  });
});
