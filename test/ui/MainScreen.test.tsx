import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let phase = 'idle';
const update = vi.fn();
vi.mock('../../src/ui/pwa/usePwaUpdate', () => ({
  usePwaUpdate: () => ({ needRefresh: true, update }),
}));
vi.mock('../../src/app/recording', async (orig) => ({
  ...(await orig<typeof import('../../src/app/recording')>()),
  useRecording: () => ({ phase }),
}));

const { MainScreen } = await import('../../src/ui/screens/MainScreen');

describe('메인 화면 (사양서 8.2, 시안 Main)', () => {
  it('주행 시작 버튼, 아래 탭 4개 (위쪽 "같이타요" 머리글과 설정 버튼은 없앰: 사용자 요청, 설정은 아래 탭)', () => {
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
    expect(screen.getAllByRole('link', { name: '설정' }).map((a) => a.getAttribute('href'))).toEqual(['#/settings']);
    expect(screen.queryByRole('heading', { name: '같이타요' })).toBeNull();
    // 위치를 못 잡았을 때 안내 말풍선도 띄우지 않는다 (사용자 요청)
    expect(screen.queryByText('위치를 받으면 지도에 표시돼요')).toBeNull();
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

  it('새 버전은 주행·기록 중이 아니면 저절로 적용하고, 기록 중에는 기다린다 (사용자 불편)', () => {
    update.mockClear();
    phase = 'recording';
    const { unmount } = render(<MainScreen />);
    expect(update).not.toHaveBeenCalled();
    unmount();
    phase = 'idle';
    render(<MainScreen />);
    expect(update).toHaveBeenCalled();
  });
});
