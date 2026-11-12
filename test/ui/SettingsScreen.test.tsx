import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('상단 표시 값 (시안 Widgets)', () => {
  it('칸 2에서 칸 1과 같은 값을 고르면 두 칸이 바뀐다. 앞 친구 간격도 고를 수 있다 (M9)', () => {
    updateSettings(DEFAULT_SETTINGS);
    render(<WidgetsScreen back="#/prepare" />);
    const slot2 = screen.getByRole('region', { name: '칸 2' });
    fireEvent.click(slot2.querySelector('button[aria-pressed="false"]')!); // 첫 번째: G미터 (칸 1과 같음)
    expect(getSettings().widgets).toEqual(['speed', 'g']);
    expect(screen.getAllByText('앞 친구 간격').length).toBe(2);
    expect(screen.getByRole('link', { name: '완료' })).toHaveAttribute('href', '#/prepare');
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
