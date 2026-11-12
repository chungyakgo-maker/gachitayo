import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionRecord } from '../../src/types/session';

const del = vi.fn(async (_id: string) => {});
const sessions: SessionRecord[] = [
  {
    id: 's1',
    courseId: null,
    courseVersion: null,
    status: 'uploaded',
    startedAt: Date.UTC(2026, 10, 12, 3, 0),
    endedAt: Date.UTC(2026, 10, 12, 3, 20),
    device: { os: 'iOS 26', browser: 'Safari', userAgent: 'ua', standalone: true },
    calibration: null,
    summary: { courseName: '오벌', lapCount: 3, bestLapMs: 61_000 } as SessionRecord['summary'],
  },
];
vi.mock('../../src/app/recording', async (orig) => ({
  ...(await orig<typeof import('../../src/app/recording')>()),
  useRecording: () => ({ sessions, sessionId: null }),
}));
vi.mock('../../src/app/sync', async (orig) => ({ ...(await orig<typeof import('../../src/app/sync')>()), deleteSessionRecord: (id: string) => del(id) }));

const { HistoryScreen } = await import('../../src/ui/screens/HistoryScreen');

describe('기록 지우기 (M10, 사용자 요청)', () => {
  it('휴지통 → 확인 창(폰·서버 모두, 되돌릴 수 없음) → 지우기', async () => {
    render(<HistoryScreen />);
    fireEvent.click(screen.getByRole('button', { name: /기록 지우기/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('폰과 서버에서 모두 지워요');
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('취소하면 지우지 않는다', () => {
    del.mockClear();
    render(<HistoryScreen />);
    fireEvent.click(screen.getByRole('button', { name: /기록 지우기/ }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(del).not.toHaveBeenCalled();
  });
});
