import { beforeEach, describe, expect, it } from 'vitest';
import { getSettings, setWidget, updateSettings, DEFAULT_SETTINGS } from '../../src/app/settings';

describe('설정 (폰 보관)', () => {
  beforeEach(() => {
    localStorage.clear();
    updateSettings(DEFAULT_SETTINGS);
  });

  it('기본값: 지도 모드, 상단 값 G미터·속도, 델타 색 초록·빨강, 앞 친구 간격 꺼짐(목표 2초), 게이트 폭 30 m', () => {
    expect(getSettings()).toEqual({ defaultMode: 'map', widgets: ['g', 'speed'], deltaPalette: 'green-red', gap: { friendId: null, nickname: null, targetS: 2 }, gateWidthM: 30 });
  });

  it('앞 친구 목표 간격은 1~10초, 0.5초 단위로 맞춘다 (폰에 저장된 값이 이상해도)', async () => {
    localStorage.setItem('gachitayo.settings', JSON.stringify({ gap: { friendId: 'u2', nickname: '지훈', targetS: 0.3 } }));
    const { vi } = await import('vitest');
    vi.resetModules();
    const m = await import('../../src/app/settings');
    expect(m.getSettings().gap).toEqual({ friendId: 'u2', nickname: '지훈', targetS: 1 });
    localStorage.setItem('gachitayo.settings', JSON.stringify({ gap: { targetS: 3.26 } }));
    vi.resetModules();
    expect((await import('../../src/app/settings')).getSettings().gap.targetS).toBe(3.5);
    localStorage.removeItem('gachitayo.settings');
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
