import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsScreen } from '../../src/ui/screens/SettingsScreen';
import { WidgetsScreen } from '../../src/ui/screens/WidgetsScreen';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../../src/app/settings';

describe('설정 탭', () => {
  it('개발자 메뉴: 재생 모드, 센서 기록 테스트', () => {
    render(<SettingsScreen />);
    expect(screen.getByRole('link', { name: /재생 모드/ })).toHaveAttribute('href', '#/dev/replay');
    expect(screen.getByRole('link', { name: /센서 기록 테스트/ })).toHaveAttribute('href', '#/dev/recorder');
  });

  it('기본 화면 모드와 델타 색을 바꾼다', () => {
    updateSettings(DEFAULT_SETTINGS);
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: '대시보드' }));
    fireEvent.click(screen.getByRole('button', { name: /파랑·주황/ }));
    expect(getSettings().defaultMode).toBe('dashboard');
    expect(getSettings().deltaPalette).toBe('blue-orange');
  });
});

describe('상단 표시 값 (시안 Widgets)', () => {
  it('칸 2에서 칸 1과 같은 값을 고르면 두 칸이 바뀐다. 앞 친구 간격은 없다', () => {
    updateSettings(DEFAULT_SETTINGS);
    render(<WidgetsScreen back="#/prepare" />);
    const slot2 = screen.getByRole('region', { name: '칸 2' });
    fireEvent.click(slot2.querySelector('button[aria-pressed="false"]')!); // 첫 번째: G미터 (칸 1과 같음)
    expect(getSettings().widgets).toEqual(['speed', 'g']);
    expect(screen.queryByText(/친구/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '완료' })).toHaveAttribute('href', '#/prepare');
  });
});
