import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let phase = 'idle';
vi.mock('../../src/ui/pwa/usePwaUpdate', () => ({
  usePwaUpdate: () => ({ needRefresh: true, update: () => {} }),
}));
vi.mock('../../src/app/recording', () => ({
  useRecording: () => ({ phase }),
}));

const { HomeScreen } = await import('../../src/ui/screens/HomeScreen');

describe('HomeScreen 새 버전 안내', () => {
  it('기록 중이 아니면 보여준다', () => {
    phase = 'idle';
    render(<HomeScreen />);
    expect(screen.getByText('새 버전이 있습니다')).toBeInTheDocument();
  });

  it('기록 중에는 숨긴다 (업데이트로 새로고침되면 기록이 끊기므로)', () => {
    phase = 'recording';
    render(<HomeScreen />);
    expect(screen.queryByText('새 버전이 있습니다')).not.toBeInTheDocument();
  });
});
