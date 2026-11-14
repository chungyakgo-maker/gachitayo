import { beforeEach, describe, expect, it } from 'vitest';
import { getSettings, setWidget, topSummary, updateSettings, DEFAULT_SETTINGS } from '../../src/app/settings';

describe('설정 (폰 보관)', () => {
  beforeEach(() => {
    localStorage.clear();
    updateSettings(DEFAULT_SETTINGS);
  });

  it('기본값: 지도 모드, 상단 칸 델타·G미터·표지판, 델타 색 초록·빨강, 앞 친구 간격 꺼짐(목표 2초), 게이트 폭 30 m, 주행 중 바탕 지도 보이기, G미터 최대 2g', () => {
    expect(getSettings()).toEqual({ defaultMode: 'map', topDelta: true, deltaSource: 'friend', widgets: ['g', 'pace'], deltaPalette: 'green-red', gap: { friendId: null, nickname: null, targetS: 2 }, gateWidthM: 30, mapView: 'fit', mapTiles: true, gMaxG: 2, driveFriends: true, mainCourses: true, curveTint: 'D' });
  });

  it('G미터 최대값은 1.5·2·2.5·3 g만 (저장된 값이 이상하면 2g)', async () => {
    updateSettings({ gMaxG: 3 });
    expect(getSettings().gMaxG).toBe(3);
    const { vi } = await import('vitest');
    localStorage.setItem('gachitayo.settings', JSON.stringify({ gMaxG: 1.5 }));
    vi.resetModules();
    expect((await import('../../src/app/settings')).getSettings().gMaxG).toBe(1.5);
    localStorage.setItem('gachitayo.settings', JSON.stringify({ gMaxG: 7 }));
    vi.resetModules();
    expect((await import('../../src/app/settings')).getSettings().gMaxG).toBe(2);
    localStorage.removeItem('gachitayo.settings');
  });

  it('커브 방향 화면 색: 끄기·A·B·C·D (기본 D), 예전 켜기/끄기 값은 D/끄기로 (사용자 요청 "abcd 다 넣어 선택할 수 있게")', async () => {
    updateSettings({ curveTint: 'B' });
    expect(getSettings().curveTint).toBe('B');
    const { vi } = await import('vitest');
    for (const [saved, want] of [[false, 'off'], [true, 'D'], ['C', 'C'], ['x', 'D']] as const) {
      localStorage.setItem('gachitayo.settings', JSON.stringify({ curveTint: saved }));
      vi.resetModules();
      expect((await import('../../src/app/settings')).getSettings().curveTint).toBe(want);
    }
    localStorage.removeItem('gachitayo.settings');
  });

  it('바탕 지도는 저장된 값이 false일 때만 끈다', () => {
    updateSettings({ mapTiles: false });
    expect(getSettings().mapTiles).toBe(false);
    updateSettings({ mapTiles: true });
    expect(getSettings().mapTiles).toBe(true);
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

  it('상단 표시 값: 다른 칸과 같은 값을 고르면 두 칸이 서로 바뀐다, 표시 안 함은 두 칸 다 고를 수 있다', () => {
    setWidget(0, 'lap');
    expect(getSettings().widgets).toEqual(['lap', 'pace']);
    setWidget(1, 'lap');
    expect(getSettings().widgets).toEqual(['pace', 'lap']);
    setWidget(0, 'none');
    setWidget(1, 'none');
    expect(getSettings().widgets).toEqual(['none', 'none']);
    expect(topSummary(getSettings())).toBe('델타 · 표시 안 함 · 표시 안 함');
    updateSettings({ topDelta: false, widgets: ['g', 'pace'] });
    expect(topSummary(getSettings())).toBe('표시 안 함 · G미터 · 표지판');
  });

  it('예전에 저장한 상단 값(칸 1 설정 전)의 속도 칸은 표지판으로 바꾼다 (속도는 지도 오른쪽 아래로 옮김, 사용자 요청)', async () => {
    const { vi } = await import('vitest');
    localStorage.setItem('gachitayo.settings', JSON.stringify({ widgets: ['g', 'speed'] }));
    vi.resetModules();
    expect((await import('../../src/app/settings')).getSettings()).toMatchObject({ topDelta: true, widgets: ['g', 'pace'] });
    // 새 형식으로 저장한 뒤에는 속도를 골라도 그대로
    localStorage.setItem('gachitayo.settings', JSON.stringify({ topDelta: false, widgets: ['speed', 'none'] }));
    vi.resetModules();
    expect((await import('../../src/app/settings')).getSettings()).toMatchObject({ topDelta: false, widgets: ['speed', 'none'] });
    // 이상한 값은 기본값
    localStorage.setItem('gachitayo.settings', JSON.stringify({ topDelta: true, widgets: ['g', 'g'] }));
    vi.resetModules();
    expect((await import('../../src/app/settings')).getSettings().widgets).toEqual(['g', 'pace']);
    localStorage.removeItem('gachitayo.settings');
  });

  it('바꾼 값은 다시 열어도 남는다', () => {
    updateSettings({ defaultMode: 'dashboard', deltaPalette: 'blue-orange' });
    const raw = JSON.parse(localStorage.getItem('gachitayo.settings')!);
    expect(raw.defaultMode).toBe('dashboard');
    expect(raw.deltaPalette).toBe('blue-orange');
  });
});

// 주행 중 칸 터치로 바꾸기 (사용자 요청, 결정 "델타↔친구델타↔끄기")
import { nextTop, nextWidget } from '../../src/app/settings';
describe('주행 중 칸을 누르면 다음 값으로', () => {
  it('칸 1: 앞 친구를 골랐으면 친구 델타 → 베스트 델타 → 표시 안 함 → 친구 델타', () => {
    expect(nextTop({ topDelta: true, deltaSource: 'friend' }, true)).toEqual({ topDelta: true, deltaSource: 'best' });
    expect(nextTop({ topDelta: true, deltaSource: 'best' }, true)).toEqual({ topDelta: false, deltaSource: 'best' });
    expect(nextTop({ topDelta: false, deltaSource: 'best' }, true)).toEqual({ topDelta: true, deltaSource: 'friend' });
  });

  it('칸 1: 앞 친구가 없으면 델타 ↔ 표시 안 함', () => {
    expect(nextTop({ topDelta: true, deltaSource: 'friend' }, false)).toEqual({ topDelta: false, deltaSource: 'friend' });
    expect(nextTop({ topDelta: false, deltaSource: 'friend' }, false)).toEqual({ topDelta: true, deltaSource: 'friend' });
  });

  it('칸 2·3: 목록 순서대로 다음 값, 다른 칸의 값·쓸 수 없는 값(코스 없으면 표지판, 앞 친구 없으면 간격)·표시 안 함은 건너뛴다', () => {
    const on = { hasCourse: true, hasFriend: true };
    expect(nextWidget(['g', 'pace'], 0, on)).toEqual(['speed', 'pace']);
    expect(nextWidget(['g', 'pace'], 1, on)).toEqual(['g', 'speed']);
    expect(nextWidget(['g', 'lapno'], 1, on)).toEqual(['g', 'gap']);
    expect(nextWidget(['speed', 'gap'], 1, on)).toEqual(['speed', 'g']);
    expect(nextWidget(['g', 'lapno'], 1, { hasCourse: true, hasFriend: false })).toEqual(['g', 'pace']);
    expect(nextWidget(['g', 'none'], 1, { hasCourse: false, hasFriend: false })).toEqual(['g', 'speed']);
    expect(nextWidget(['none', 'none'], 0, on)).toEqual(['g', 'none']);
  });

  it('칸 1 설정(베스트·친구)은 저장되고, 예전 값이면 친구', async () => {
    updateSettings({ deltaSource: 'best' });
    expect(getSettings().deltaSource).toBe('best');
    expect(DEFAULT_SETTINGS.deltaSource).toBe('friend');
  });
});
