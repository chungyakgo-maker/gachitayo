// 기울기 합치기 스위치 (2026-11-19 세영 "웹에서 테스트하게 앱은 건들지말고"): 웹 빌드만 켠다
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leanFused } from '../../src/features';

afterEach(() => vi.unstubAllEnvs());

describe('leanFused', () => {
  it('웹 빌드는 켜고, 아이폰 앱 빌드(--mode app)는 끈다', () => {
    vi.stubEnv('MODE', 'production');
    expect(leanFused()).toBe(true);
    vi.stubEnv('MODE', 'app');
    expect(leanFused()).toBe(false);
  });
});

describe('zeroLean', () => {
  it('주행 준비 중이 아니면 0점을 맞출 수 없다', async () => {
    const { zeroLean } = await import('../../src/app/drive');
    expect(zeroLean()).toBe(false);
  });
});
