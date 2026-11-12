import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AccountState } from '../../src/app/account';

let acc: AccountState;
vi.mock('../../src/app/account', async (orig) => ({
  ...(await orig<typeof import('../../src/app/account')>()),
  useAccount: () => acc,
}));

const { MainScreen } = await import('../../src/ui/screens/MainScreen');
const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');

const base: AccountState = { status: 'none', userId: null, nickname: '민수', onboarded: true, lost: false, busy: false, error: null };

describe('계정 안내 (사양서 9장)', () => {
  it('서버 연결 전에 시작해 아직 계정이 없으면 "끊김" 경고 대신 자동으로 만든다고 알린다', () => {
    acc = base;
    const { unmount } = render(<MainScreen />);
    expect(screen.queryByText(/계정 연결이 끊겨/)).not.toBeInTheDocument();
    unmount();
    render(<SettingsScreen />);
    expect(screen.getByText(/자동으로 만들고 기록을 올려요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '지금 계정 만들기' })).toBeInTheDocument();
    expect(screen.queryByText(/계정 연결이 끊겼어요/)).not.toBeInTheDocument();
  });

  it('있던 계정이 끊기면 첫 화면에 경고, 설정에서 새 계정 만들기', () => {
    acc = { ...base, userId: 'u1', lost: true };
    const { unmount } = render(<MainScreen />);
    expect(screen.getByText(/계정 연결이 끊겨 업로드할 수 없어요/)).toBeInTheDocument();
    unmount();
    render(<SettingsScreen />);
    expect(screen.getByText(/계정 연결이 끊겼어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 계정 만들기' })).toBeInTheDocument();
  });
});
