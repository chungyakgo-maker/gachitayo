// 설정 › 저장 공간·백업, 기록 탭 표시 (기록은 폰에만 7단계, 시안 docs/mock/2026-11-18-local-storage.jpg ①②③⑤)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  summary: { sessions: 42, rawSessions: 30, rawBytes: 152 * 1024 * 1024, myCourses: 5, prunable: 0, usage: null as { used: number; quota: number } | null },
  last: null as { at: number; bytes: number } | null,
  due: false,
  calls: [] as string[],
  sessions: [] as unknown[],
}));
vi.mock('../../src/app/storageLimits', async (orig) => ({
  ...(await orig<typeof import('../../src/app/storageLimits')>()),
  storageSummary: async () => h.summary,
  pruneOldRaw: async () => {
    h.calls.push('prune');
    h.summary = { ...h.summary, prunable: 0 };
    return 3;
  },
}));
vi.mock('../../src/app/backup', async (orig) => ({
  ...(await orig<typeof import('../../src/app/backup')>()),
  shareBackup: async () => {
    h.calls.push('share');
    h.last = { at: Date.UTC(2026, 10, 18, 3), bytes: 38 * 1024 * 1024 };
    return 'shared';
  },
  lastBackup: () => h.last,
  peekBackup: async () => ({ format: 'dgo-backup', version: 1, createdAt: 1, sessions: 42, courses: 5 }),
  importBackup: async (f: File) => {
    h.calls.push(`import ${f.name}`);
    return { sessions: 2, courses: 1, skipped: 40 };
  },
  backupReminderDue: () => h.due,
  snoozeBackupReminder: () => {
    h.calls.push('snooze');
    h.due = false;
  },
}));
vi.mock('../../src/app/recording', async (orig) => {
  const real = await orig<typeof import('../../src/app/recording')>();
  return {
    ...real,
    useRecording: () => ({ ...real.getRecordingState(), sessions: h.sessions, sessionId: null }),
    refreshSessions: async () => void h.calls.push('refresh'),
  };
});

const { StorageSection } = await import('../../src/ui/components/StorageSection');
const { BackupSection } = await import('../../src/ui/components/BackupSection');
const { HistoryScreen } = await import('../../src/ui/screens/HistoryScreen');
const { ReplayScreen } = await import('../../src/ui/screens/ReplayScreen');

const device = { os: 'iOS', browser: 'Safari', userAgent: 'ua', standalone: true };
const rec = (id: string, extra: Record<string, unknown> = {}) => ({ id, courseId: null, courseVersion: null, status: 'processed', startedAt: 1_800_000_000_000, endedAt: 1_800_000_060_000, device, calibration: null, summary: { courseName: '북악', lapCount: 3, bestLapMs: 161_380 }, ...extra });

beforeEach(() => {
  cleanup();
  h.summary = { sessions: 42, rawSessions: 30, rawBytes: 152 * 1024 * 1024, myCourses: 5, prunable: 0, usage: null };
  h.last = null;
  h.due = false;
  h.calls = [];
  h.sessions = [];
});

describe('설정 › 저장 공간 (시안 ①)', () => {
  it('기록 수·원본 최근 30개·크기·내 코스 N / 200, 웹이면 브라우저 안내', async () => {
    render(<StorageSection />);
    const sec = screen.getByRole('region', { name: '저장 공간' });
    await waitFor(() => expect(within(sec).getByText('42개')).toBeInTheDocument());
    expect(within(sec).getByText('최근 30개 · 152 MB')).toBeInTheDocument();
    expect(within(sec).getByText('5 / 200')).toBeInTheDocument();
    expect(within(sec).getByText(/원본은 최근 30개 주행만 남겨요/)).toBeInTheDocument();
    expect(within(sec).getByText(/브라우저는 오래 안 쓰면 기록을 지울 수 있어요/)).toBeInTheDocument();
  });

  it('원본이 하나도 없으면 "없음"', async () => {
    h.summary = { ...h.summary, sessions: 0, rawSessions: 0, rawBytes: 0, myCourses: 0 };
    render(<StorageSection />);
    const sec = screen.getByRole('region', { name: '저장 공간' });
    await waitFor(() => expect(within(sec).getByText('없음')).toBeInTheDocument());
    expect(within(sec).queryByText(/KB/)).toBeNull();
  });

  it('"오래된 원본 지금 지우기"는 지울 것이 없으면 꺼져 있고, 있으면 지운다', async () => {
    h.summary = { ...h.summary, prunable: 3 };
    render(<StorageSection />);
    const btn = await screen.findByRole('button', { name: '오래된 원본 지금 지우기' });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(h.calls).toContain('prune'));
    // 기록 탭·재생 목록의 "원본 정리됨"도 바로 바뀌게 (검토 지적)
    await waitFor(() => expect(h.calls).toContain('refresh'));
    await waitFor(() => expect(btn).toBeDisabled());
  });
});

describe('설정 › 백업 (시안 ②③)', () => {
  it('전체 백업 파일 만들기 → 공유 창, 끝나면 "마지막 백업"', async () => {
    render(<BackupSection />);
    const sec = screen.getByRole('region', { name: '백업' });
    expect(within(sec).getByText('기록은 이 폰에만 있어요. 폰을 바꾸거나 앱을 지우기 전에 백업 파일을 만들어 두세요.')).toBeInTheDocument();
    expect(within(sec).getByText('아직 백업한 적이 없어요')).toBeInTheDocument();
    fireEvent.click(within(sec).getByRole('button', { name: '전체 백업 파일 만들기' }));
    await waitFor(() => expect(within(sec).getByText('마지막 백업 11월 18일 · 38 MB')).toBeInTheDocument());
    expect(h.calls).toEqual(['share']);
  });

  it('백업 파일 불러오기 → 확인 창(기록 N개 · 내 코스 N개) → 불러오기', async () => {
    render(<BackupSection />);
    const input = screen.getByLabelText('백업 파일 고르기') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], '디고 백업 2026-11-18.dgo');
    fireEvent.change(input, { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog', { name: '백업 파일을 불러올까요?' });
    expect(dialog).toHaveTextContent('디고 백업 2026-11-18');
    expect(dialog).toHaveTextContent('기록 42개 · 내 코스 5개');
    expect(dialog).toHaveTextContent('이 폰에 이미 있는 기록은 그대로 두고, 없는 것만 더해요.');
    fireEvent.click(within(dialog).getByRole('button', { name: '불러오기' }));
    await waitFor(() => expect(screen.getByText('기록 2개 · 내 코스 1개를 더했어요 (이미 있던 기록 40개는 그대로)')).toBeInTheDocument());
    expect(h.calls).toEqual(['import 디고 백업 2026-11-18.dgo']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('기록 탭 (시안 ⑤)', () => {
  it('원본이 정리된 기록은 "원본 정리됨", 백업 알림은 조건일 때만, 닫으면 미룬다', () => {
    h.sessions = [rec('a'), rec('b', { rawPruned: true, startedAt: 1_700_000_000_000 })];
    const { unmount } = render(<HistoryScreen />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).not.toHaveTextContent('원본 정리됨');
    expect(rows[1]).toHaveTextContent('원본 정리됨');
    expect(screen.queryByText(/30일 지났어요/)).toBeNull();
    unmount();
    h.due = true;
    h.last = { at: 1_700_000_000_000, bytes: 1 };
    render(<HistoryScreen />);
    expect(screen.getByText(/마지막 백업이 30일 지났어요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '백업 알림 닫기' }));
    expect(h.calls).toContain('snooze');
    expect(screen.queryByText(/30일 지났어요/)).toBeNull();
  });

  it('재생 모드: 원본이 정리된 기록은 고를 수 없다', () => {
    h.sessions = [rec('a'), rec('b', { rawPruned: true })];
    render(<ReplayScreen />);
    const sec = screen.getByRole('region', { name: '저장된 기록' });
    const items = within(sec).getAllByRole('button');
    expect(items[0]).toBeEnabled();
    expect(items[1]).toBeDisabled();
    expect(items[1]).toHaveTextContent('원본 정리됨 · 재생 안 돼요');
  });
});
