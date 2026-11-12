import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InterruptedPrompt } from '../../src/ui/components/InterruptedPrompt';

describe('InterruptedPrompt', () => {
  const startedAt = Date.UTC(2026, 10, 12, 1, 22);

  it('중단된 기록의 시작 시각(KST)과 두 가지 선택지를 보여준다', () => {
    render(<InterruptedPrompt startedAt={startedAt} onResume={() => {}} onFinish={() => {}} />);
    expect(screen.getByText('중단된 기록이 있습니다')).toBeInTheDocument();
    expect(screen.getByText(/2026-11-12 10:22/)).toBeInTheDocument();
  });

  it('이어서 하기와 끝내기는 각각의 처리를 부른다', async () => {
    const onResume = vi.fn();
    const onFinish = vi.fn();
    render(<InterruptedPrompt startedAt={startedAt} onResume={onResume} onFinish={onFinish} />);
    await userEvent.click(screen.getByRole('button', { name: '이어서 하기' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '끝내기' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
