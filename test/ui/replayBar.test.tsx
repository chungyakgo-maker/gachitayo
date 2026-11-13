import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReplayBar } from '../../src/ui/components/ReplayBar';

describe('재생 막대 (사양서 10.2, 시안)', () => {
  const base = { posMs: 112_000, endMs: 364_000, playing: true, speed: 5 };

  it('지금 시간 · 막대 · 전체 시간 · 배속, 재생 중이면 멈춤 버튼', () => {
    render(<ReplayBar {...base} onPlayPause={() => {}} onSeek={() => {}} onSpeed={() => {}} />);
    const bar = screen.getByRole('group', { name: '재생 막대' });
    expect(bar).toHaveTextContent('1:52');
    expect(bar).toHaveTextContent('6:04');
    const range = screen.getByRole('slider', { name: '재생 위치' }) as HTMLInputElement;
    expect(range.value).toBe('112000');
    expect(range.max).toBe('364000');
    expect(range.step).toBe('100');
    expect(screen.getByRole('button', { name: '멈춤' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /재생 속도 5배/ })).toHaveTextContent('5×');
  });

  it('멈춰 있으면 재생 버튼, 누르고 끌고 배속을 바꾸면 각각 알린다', () => {
    const onPlayPause = vi.fn();
    const onSeek = vi.fn();
    const onSpeed = vi.fn();
    render(<ReplayBar {...base} playing={false} onPlayPause={onPlayPause} onSeek={onSeek} onSpeed={onSpeed} />);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    fireEvent.change(screen.getByRole('slider', { name: '재생 위치' }), { target: { value: '200000' } });
    fireEvent.click(screen.getByRole('button', { name: /재생 속도/ }));
    expect(onPlayPause).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(200_000);
    expect(onSpeed).toHaveBeenCalledTimes(1);
  });

  it('한 시간 넘는 주행은 시:분:초', () => {
    render(<ReplayBar posMs={3_725_000} endMs={3_900_000} playing={false} speed={20} onPlayPause={() => {}} onSeek={() => {}} onSpeed={() => {}} />);
    const bar = screen.getByRole('group', { name: '재생 막대' });
    expect(bar).toHaveTextContent('1:02:05');
    expect(bar).toHaveTextContent('1:05:00');
    expect(bar).toHaveTextContent('20×');
  });
});
