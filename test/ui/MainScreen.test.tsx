import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let phase = 'idle';
vi.mock('../../src/ui/pwa/usePwaUpdate', () => ({
  usePwaUpdate: () => ({ needRefresh: true, update: () => {} }),
}));
vi.mock('../../src/app/recording', async (orig) => ({
  ...(await orig<typeof import('../../src/app/recording')>()),
  useRecording: () => ({ phase }),
}));

const { MainScreen } = await import('../../src/ui/screens/MainScreen');

describe('메인 화면 (사양서 8.2, 시안 Main)', () => {
  it('주행 시작 버튼, 아래 탭 4개, 설정 버튼', () => {
    phase = 'idle';
    render(<MainScreen />);
    expect(screen.getByRole('button', { name: /주행 시작/ })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '주 메뉴' });
    expect([...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['메인', '#/'],
      ['코스', '#/courses'],
      ['기록', '#/history'],
      ['설정', '#/settings'],
    ]);
    // 머리글의 설정 버튼과 아래 탭
    expect(screen.getAllByRole('link', { name: '설정' }).map((a) => a.getAttribute('href'))).toEqual(['#/settings', '#/settings']);
  });

  it('친구·위치 공유 관련 표시는 없다 (1단계 범위 밖)', () => {
    phase = 'idle';
    render(<MainScreen />);
    expect(screen.queryByText(/위치 공유|같이 달리기|친구/)).not.toBeInTheDocument();
  });

  it('새 버전 안내: 기록 중이 아니면 보여주고, 기록 중에는 숨긴다', () => {
    phase = 'idle';
    const { unmount } = render(<MainScreen />);
    expect(screen.getByText('새 버전이 있습니다')).toBeInTheDocument();
    unmount();
    phase = 'recording';
    render(<MainScreen />);
    expect(screen.queryByText('새 버전이 있습니다')).not.toBeInTheDocument();
  });
});
