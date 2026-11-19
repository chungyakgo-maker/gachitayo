// 검토 지적 2: "지우기 전에 백업 파일 만들기"를 누른 뒤 백업이 끝나기 전에 지우기를 누르면 백업 없이 지워졌다 → 백업 중엔 지우기·체크를 막는다
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ done: null as null | ((v: 'shared') => void) }));
vi.mock('../../src/app/backup', async (orig) => ({
  ...(await orig<typeof import('../../src/app/backup')>()),
  shareBackup: () => new Promise<'shared'>((res) => (h.done = res)),
}));

const { DeleteAccountSection } = await import('../../src/ui/screens/SettingsScreen');

describe('지우기 전 백업 중에는 지우기를 막는다', () => {
  it('백업 만드는 중: 지우기·체크 꺼짐, 끝나면 다시 켜짐', async () => {
    render(<DeleteAccountSection />);
    fireEvent.click(screen.getByRole('button', { name: '계정 지우기' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '기록과 내 코스도 이 폰에서 지우기' }));
    fireEvent.click(screen.getByRole('button', { name: '지우기 전에 백업 파일 만들기 ›' }));
    expect(screen.getByText('백업 파일 만드는 중…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '지우기' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '기록과 내 코스도 이 폰에서 지우기' })).toBeDisabled();
    h.done!('shared');
    await waitFor(() => expect(screen.getByRole('button', { name: '지우기' })).toBeEnabled());
    expect(screen.getByText('백업 파일을 만들었어요')).toBeInTheDocument();
  });
});
