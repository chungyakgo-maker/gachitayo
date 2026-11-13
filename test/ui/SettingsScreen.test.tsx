import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SettingsScreen } from '../../src/ui/screens/SettingsScreen';
import { WidgetsScreen } from '../../src/ui/screens/WidgetsScreen';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../../src/app/settings';

describe('설정 탭', () => {
  it('버전(커밋 번호·빌드 시각)은 설정에서 본다', async () => {
    const { buildInfo } = await import('../../src/ui/buildInfo');
    render(<SettingsScreen />);
    expect(screen.getByText(new RegExp(`버전 ${buildInfo.version} `))).toBeInTheDocument();
  });

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

describe('커브 방향 화면 색 켜기·끄기 (사용자 요청)', () => {
  it('설정에서 켜기/끄기', () => {
    updateSettings(DEFAULT_SETTINGS);
    render(<SettingsScreen />);
    const sec = screen.getByRole('region', { name: '커브 방향 화면 색' });
    expect(within(sec).getByRole('button', { name: '켜기' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(sec).getByRole('button', { name: '끄기' }));
    expect(getSettings().curveTint).toBe(false);
  });
});

describe('상단 표시 값 (시안 Widgets): 칸 1 델타, 칸 2 왼쪽, 칸 3 오른쪽 (사용자 요청)', () => {
  it('칸 3에서 칸 2와 같은 값을 고르면 두 칸이 바뀐다. 앞 친구 간격·표지판도 고를 수 있다', () => {
    updateSettings(DEFAULT_SETTINGS);
    render(<WidgetsScreen back="#/prepare" />);
    const slot3 = screen.getByRole('region', { name: '칸 3 (오른쪽)' });
    fireEvent.click(within(slot3).getByRole('button', { name: 'G미터' }));
    expect(getSettings().widgets).toEqual(['pace', 'g']);
    expect(screen.getAllByRole('button', { name: '앞 친구 간격' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: '표지판' }).length).toBe(2);
    expect(screen.getByRole('link', { name: '완료' })).toHaveAttribute('href', '#/prepare');
  });

  it('세 칸 모두 표시 안 함을 고를 수 있다 (칸 1은 델타 또는 표시 안 함)', () => {
    updateSettings(DEFAULT_SETTINGS);
    render(<WidgetsScreen back="#/settings" />);
    const slot1 = screen.getByRole('region', { name: '칸 1 (위)' });
    expect(within(slot1).getAllByRole('button').map((b) => b.textContent)).toEqual(['델타', '표시 안 함']);
    fireEvent.click(within(slot1).getByRole('button', { name: '표시 안 함' }));
    fireEvent.click(within(screen.getByRole('region', { name: '칸 2 (왼쪽)' })).getByRole('button', { name: '표시 안 함' }));
    fireEvent.click(within(screen.getByRole('region', { name: '칸 3 (오른쪽)' })).getByRole('button', { name: '표시 안 함' }));
    expect(getSettings()).toMatchObject({ topDelta: false, widgets: ['none', 'none'] });
  });
});

describe('설정: 닉네임·동기화 (사양서 8.8)', () => {
  it('서버 연결 전이면 "폰에만 저장"을 알리고 닉네임은 폰에 저장한다', async () => {
    const { waitFor } = await import('@testing-library/react');
    render(<SettingsScreen />);
    expect(screen.getByText('서버 연결 전 · 폰에만 저장')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: '지훈' } });
    fireEvent.click(screen.getAllByRole('button', { name: '저장' })[0]!);
    await waitFor(() => expect(localStorage.getItem('gachitayo.nickname')).toBe('지훈'));
  });
});
