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

const ready: AccountState = { status: 'ready', userId: 'u1', nickname: '민수', onboarded: true, lost: false, busy: false, error: null };
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
