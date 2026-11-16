// 재생 모드를 기본 기능으로 (사용자 요청 "재생모드는 개발자 모드에서 빼, 기본기능으로 탑재"): 기록 탭에서 들어가고, 개발자 메뉴에는 없다
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

describe('재생 모드 메뉴', () => {
  it('history tab links to replay', async () => {
    const { HistoryScreen } = await import('../../src/ui/screens/HistoryScreen');
    render(<HistoryScreen />);
    expect(screen.getByRole('link', { name: /재생 모드/ })).toHaveAttribute('href', '#/replay');
  });

  it('settings developer menu no longer has it', async () => {
    const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
    render(<SettingsScreen />);
    const dev = screen.getByRole('region', { name: '개발자 메뉴' });
    expect(within(dev).queryByText('재생 모드')).toBeNull();
  });

  it('replay screen goes back to history', async () => {
    const { ReplayScreen } = await import('../../src/ui/screens/ReplayScreen');
    render(<ReplayScreen />);
    expect(screen.getByRole('link', { name: '기록으로' })).toHaveAttribute('href', '#/history');
  });
});
