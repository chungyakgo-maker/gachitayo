import { beforeEach, describe, expect, it } from 'vitest';
import { getSettings, setWidget, updateSettings, DEFAULT_SETTINGS } from '../../src/app/settings';

describe('설정 (폰 보관)', () => {
  beforeEach(() => {
    localStorage.clear();
    updateSettings(DEFAULT_SETTINGS);
  });

  it('기본값: 지도 모드, 상단 값 G미터·속도, 델타 색 초록·빨강', () => {
    expect(getSettings()).toEqual({ defaultMode: 'map', widgets: ['g', 'speed'], deltaPalette: 'green-red' });
  });

  it('상단 표시 값: 다른 칸과 같은 값을 고르면 두 칸이 서로 바뀐다', () => {
    setWidget(0, 'lap');
    expect(getSettings().widgets).toEqual(['lap', 'speed']);
    setWidget(1, 'lap');
    expect(getSettings().widgets).toEqual(['speed', 'lap']);
  });

  it('바꾼 값은 다시 열어도 남는다', () => {
    updateSettings({ defaultMode: 'dashboard', deltaPalette: 'blue-orange' });
    const raw = JSON.parse(localStorage.getItem('gachitayo.settings')!);
    expect(raw.defaultMode).toBe('dashboard');
    expect(raw.deltaPalette).toBe('blue-orange');
  });
});
