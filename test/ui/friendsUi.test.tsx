import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AccountState } from '../../src/app/account';
import type { FriendsState } from '../../src/app/friends';

let acc: AccountState;
let fr: FriendsState;
const addFriendByCode = vi.fn(async (_code: string) => true);
const removeFriend = vi.fn(async (_id: string) => {});
const setSharing = vi.fn(async (_on: boolean) => {});

vi.mock('../../src/app/account', async (orig) => ({
  ...(await orig<typeof import('../../src/app/account')>()),
  useAccount: () => acc,
}));
vi.mock('../../src/app/friends', async (orig) => ({
  ...(await orig<typeof import('../../src/app/friends')>()),
  useFriends: () => fr,
  loadFriends: vi.fn(async () => {}),
  watchFriendPositions: vi.fn(() => () => {}),
  addFriendByCode: (c: string) => addFriendByCode(c),
  removeFriend: (id: string) => removeFriend(id),
  setSharing: (on: boolean) => setSharing(on),
}));
vi.mock('../../src/ui/pwa/usePwaUpdate', () => ({ usePwaUpdate: () => ({ needRefresh: false, update: () => {} }) }));

const { FriendsSection } = await import('../../src/ui/components/FriendsSection');
const { MainScreen } = await import('../../src/ui/screens/MainScreen');
const { ShareToggle } = await import('../../src/ui/components/ShareToggle');
const { useDriveFriends } = await import('../../src/ui/screens/DriveScreen');
const { watchFriendPositions } = await import('../../src/app/friends');

const ready: AccountState = { status: 'ready', userId: 'u1', nickname: '민수', onboarded: true, lost: false, kakao: false, busy: false, error: null };
const base: FriendsState = {
  available: true,
  code: 'K7P2Q9XM',
  friends: [
    { userId: 'u2', nickname: '지훈', since: 'x', sharing: true },
    { userId: 'u3', nickname: '남', since: 'x', sharing: false },
  ],
  loaded: true,
  busy: false,
  error: null,
  notice: null,
  sharing: false,
  lastSentAt: null,
  positions: [],
};

beforeEach(() => {
  acc = ready;
  fr = base;
  addFriendByCode.mockClear();
  removeFriend.mockClear();
  setSharing.mockClear();
});

describe('설정 · 친구 (사양서 8.8, M8)', () => {
  it('내 친구 코드, 친구 코드 넣기, 친구 목록(공유 중 표시)', () => {
    render(<FriendsSection />);
    expect(screen.getByLabelText('내 친구 코드')).toHaveTextContent('K7P2-Q9XM');
    fireEvent.change(screen.getByLabelText('친구 코드 넣기'), { target: { value: 'abcd-efgh' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(addFriendByCode).toHaveBeenCalledWith('abcd-efgh');
    const list = screen.getByRole('list', { name: '친구 목록' });
    expect(list).toHaveTextContent('지훈위치 공유 중');
    expect(list).toHaveTextContent('남공유 안 함');
  });

  it('끊기는 한 번 더 확인한다', () => {
    render(<FriendsSection />);
    fireEvent.click(screen.getByRole('button', { name: '지훈 친구 끊기' }));
    expect(removeFriend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '끊기' }));
    expect(removeFriend).toHaveBeenCalledWith('u2');
  });

  it('서버 계정이 없으면 친구 기능을 쓸 수 없다고 알린다', () => {
    acc = { ...ready, status: 'none', userId: null };
    render(<FriendsSection />);
    expect(screen.getByText(/서버 계정이 있어야 해요/)).toBeInTheDocument();
    expect(screen.queryByLabelText('친구 코드 넣기')).not.toBeInTheDocument();
  });
});

describe('메인 지도 · 위치 공유 (사양서 8.2, M8)', () => {
  it('켜기 전에 친구 몇 명에게 보이는지 확인을 받는다', () => {
    render(<MainScreen />);
    const btn = screen.getByRole('button', { name: /위치 공유 꺼짐/ });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(screen.getByRole('dialog')).toHaveTextContent('친구 2명에게 내 위치가 보여요');
    fireEvent.click(screen.getByRole('button', { name: '공유 켜기' }));
    expect(setSharing).toHaveBeenCalledWith(true);
  });

  it('공유 중이면 누르면 바로 끈다', () => {
    fr = { ...base, sharing: true };
    render(<MainScreen />);
    fireEvent.click(screen.getByRole('button', { name: /위치 공유 중/ }));
    expect(setSharing).toHaveBeenCalledWith(false);
  });

  it('친구가 없으면 친구 추가로 안내한다', () => {
    fr = { ...base, friends: [] };
    render(<MainScreen />);
    fireEvent.click(screen.getByRole('button', { name: /위치 공유 꺼짐/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('아직 친구가 없어요');
    expect(screen.getByRole('link', { name: '친구 추가하러 가기' })).toHaveAttribute('href', '#/settings');
    expect(setSharing).not.toHaveBeenCalled();
  });

  it('서버 계정이 없으면 위치 공유 버튼이 없다', () => {
    acc = { ...ready, status: 'disabled', userId: null };
    render(<MainScreen />);
    expect(screen.queryByRole('button', { name: /위치 공유/ })).not.toBeInTheDocument();
  });
});

describe('주행 중 위치 공유 (사용자 요청)', () => {
  it('주행 준비의 위치 공유 칸: 켜기 → 주행 중에도 보낸다는 확인 → 공유 켜기', () => {
    acc = ready;
    fr = { ...base, sharing: false };
    setSharing.mockClear();
    render(<ShareToggle variant="card" />);
    expect(screen.getByRole('region', { name: '위치 공유' })).toHaveTextContent('꺼짐');
    fireEvent.click(screen.getByRole('button', { name: '켜기' }));
    expect(screen.getByRole('dialog', { name: '위치 공유' })).toHaveTextContent('주행 중에도 계속 보내고');
    fireEvent.click(screen.getByRole('button', { name: '공유 켜기' }));
    expect(setSharing).toHaveBeenCalledWith(true);
  });

  it('주행 지도용 친구 위치: 주행 중에 받아 오고, 앞 친구(간격)는 빼고 지도 평면으로', async () => {
    const { renderHook } = await import('@testing-library/react');
    acc = ready;
    fr = {
      ...base,
      positions: [
        { userId: 'u2', nickname: '지훈', lat: 37.2001, lon: 127.1, hAcc: 5, heading: null, speed: 10, ageMs: 1000 },
        { userId: 'u3', nickname: '남', lat: 37.2, lon: 127.1001, hAcc: 5, heading: null, speed: 10, ageMs: 1000 },
      ],
    };
    vi.mocked(watchFriendPositions).mockClear();
    const snap = { origin: { lat: 37.2, lon: 127.1 } } as Parameters<typeof useDriveFriends>[0];
    const { result } = renderHook(() => useDriveFriends(snap, 'u2'));
    expect(watchFriendPositions).toHaveBeenCalled();
    expect(result.current.map((f) => f.label)).toEqual(['남']);
    expect(result.current[0]!.x).toBeCloseTo(8.9, 0);
    const none = renderHook(() => useDriveFriends(null, null));
    expect(none.result.current).toEqual([]);
  });

  it('주행 지도 친구 위치를 끄면(설정) 받아 오지도 않고 그리지도 않는다 (사용자 요청)', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { updateSettings, DEFAULT_SETTINGS } = await import('../../src/app/settings');
    acc = ready;
    fr = { ...base, positions: [{ userId: 'u3', nickname: '남', lat: 37.2, lon: 127.1001, hAcc: 5, heading: null, speed: 10, ageMs: 1000 }] };
    vi.mocked(watchFriendPositions).mockClear();
    updateSettings({ driveFriends: false });
    const snap = { origin: { lat: 37.2, lon: 127.1 } } as Parameters<typeof useDriveFriends>[0];
    const { result } = renderHook(() => useDriveFriends(snap, null));
    expect(result.current).toEqual([]);
    expect(watchFriendPositions).not.toHaveBeenCalled();
    updateSettings(DEFAULT_SETTINGS);
  });
});
