import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AccountState } from '../../src/app/account';
import type { FriendsState } from '../../src/app/friends';

let acc: AccountState;
let fr: FriendsState;
vi.mock('../../src/app/account', async (orig) => ({ ...(await orig<typeof import('../../src/app/account')>()), useAccount: () => acc }));
vi.mock('../../src/app/friends', async (orig) => ({
  ...(await orig<typeof import('../../src/app/friends')>()),
  useFriends: () => fr,
  loadFriends: vi.fn(async () => {}),
}));

const { GapSection } = await import('../../src/ui/components/GapSection');
const { getSettings, updateSettings, DEFAULT_SETTINGS } = await import('../../src/app/settings');

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
  localStorage.clear();
  updateSettings(DEFAULT_SETTINGS);
});

describe('주행 준비 · 앞 친구 간격 (M9)', () => {
  it('처음 고를 때 안전 안내를 한 번 보여주고, 확인하면 켠다', () => {
    render(<GapSection />);
    fireEvent.click(screen.getByRole('button', { name: /지훈/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('주행 중에는 화면 대신 도로를 보세요');
    expect(getSettings().gap.friendId).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '확인하고 켜기' }));
    expect(getSettings().gap).toMatchObject({ friendId: 'u2', nickname: '지훈' });
    // 두 번째부터는 묻지 않는다
    fireEvent.click(screen.getByRole('button', { name: '남' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getSettings().gap.friendId).toBe('u3');
  });

  it('목표 간격은 0.5초씩, 1초 아래로는 못 줄인다', () => {
    localStorage.setItem('gachitayo.gapSafetyAck', '1');
    render(<GapSection />);
    fireEvent.click(screen.getByRole('button', { name: /지훈/ }));
    expect(screen.getByText('목표 2.0초')).toBeInTheDocument();
    const down = screen.getByRole('button', { name: '목표 간격 줄이기' });
    fireEvent.click(down);
    fireEvent.click(down);
    expect(getSettings().gap.targetS).toBe(1);
    expect(down).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '목표 간격 늘리기' }));
    expect(getSettings().gap.targetS).toBe(1.5);
    expect(screen.getByText(/지훈 님이 위치를 공유하는 중이에요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '끄기' }));
    expect(getSettings().gap.friendId).toBeNull();
  });

  it('친구가 없거나 서버 계정이 없으면 보이지 않는다', () => {
    fr = { ...base, friends: [] };
    const { container, unmount } = render(<GapSection />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    fr = base;
    acc = { ...ready, status: 'disabled' };
    expect(render(<GapSection />).container).toBeEmptyDOMElement();
  });
});
