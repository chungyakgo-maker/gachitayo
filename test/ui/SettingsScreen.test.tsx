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

  it('개발자 메뉴: 센서 기록 테스트 (재생 모드는 기록 탭의 기본 기능으로 옮김, 사용자 요청)', () => {
    render(<SettingsScreen />);
    expect(screen.queryByRole('link', { name: /재생 모드/ })).toBeNull();
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

describe('커브 방향 화면 색 고르기 (사용자 요청 "abcd 다 넣어 선택할 수 있게")', () => {
  it('설정에서 끄기·A·B·C·D 중 하나', () => {
    updateSettings(DEFAULT_SETTINGS);
    render(<SettingsScreen />);
    const sec = screen.getByRole('region', { name: '커브 방향 화면 색' });
    expect(within(sec).getAllByRole('button').map((b) => b.textContent)).toEqual(['끄기', 'A 화면 전체', 'B 전체 · 가까울수록 진하게', 'C 네 가장자리', 'D 커브 쪽 가장자리']);
    expect(within(sec).getByRole('button', { name: 'D 커브 쪽 가장자리' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(sec).getByRole('button', { name: 'A 화면 전체' }));
    expect(getSettings().curveTint).toBe('A');
    fireEvent.click(within(sec).getByRole('button', { name: '끄기' }));
    expect(getSettings().curveTint).toBe('off');
  });
});

describe('내 차 표시 고르기 (사용자 요청 시안 2026-11-17: 화살표·흰 차·파란 점·빨간 차)', () => {
  it('설정에서 네 가지 중 하나, 처음은 화살표', () => {
    updateSettings(DEFAULT_SETTINGS);
    render(<SettingsScreen />);
    const sec = screen.getByRole('region', { name: '내 차 표시' });
    expect(within(sec).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['화살표', '흰 차', '파란 점', '빨간 차']);
    expect(within(sec).getByRole('button', { name: '화살표' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(sec).getByRole('button', { name: '빨간 차' }));
    expect(getSettings().carMarker).toBe('red');
    expect(within(sec).getByRole('button', { name: '빨간 차' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('바이크 모드 (2026-11-18 시안)', () => {
  it('탈것을 바이크로 바꾸면 내 바이크 표시 5종이 나오고, 고른 것이 저장된다', () => {
    updateSettings(DEFAULT_SETTINGS);
    render(<SettingsScreen />);
    const veh = screen.getByRole('region', { name: '탈것' });
    expect(within(veh).getByRole('button', { name: '자동차' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: '내 바이크 표시' })).toBeNull();
    fireEvent.click(within(veh).getByRole('button', { name: '바이크' }));
    expect(getSettings().vehicle).toBe('bike');
    expect(screen.queryByRole('region', { name: '내 차 표시' })).toBeNull();
    const sec = screen.getByRole('region', { name: '내 바이크 표시' });
    expect(within(sec).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['스쿠터', 'R차', '크루저', '네이키드', '모타드']);
    expect(within(sec).getByRole('button', { name: 'R차' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(sec).getByRole('button', { name: '크루저' }));
    expect(getSettings().bikeMarker).toBe('cruiser');
    expect(screen.getByText(/고속도로·자동차전용도로를 피해요/)).toBeInTheDocument();
    updateSettings(DEFAULT_SETTINGS);
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

describe('설정: 닉네임 (사양서 8.8) · 동기화 없음 (기록은 폰에만)', () => {
  it('동기화·업로드 칸이 없고, 닉네임은 폰에 저장한다', async () => {
    const { waitFor } = await import('@testing-library/react');
    render(<SettingsScreen />);
    expect(screen.queryByRole('region', { name: '동기화 상태' })).toBeNull();
    expect(screen.queryByText(/업로드|동기화/)).toBeNull();
    fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: '지훈' } });
    fireEvent.click(screen.getAllByRole('button', { name: '저장' })[0]!);
    await waitFor(() => expect(localStorage.getItem('gachitayo.nickname')).toBe('지훈'));
  });
});
