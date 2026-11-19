// 기울기 합치기 스위치 (2026-11-19 세영 "웹에서 테스트하게 앱은 건들지말고" → "이대로 정식버전(위치공유 x)도 배포해"):
// 웹·아이폰 앱 모두 켠다. 빌드 값 VITE_LEAN_FUSED=off 로만 끈다
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leanFused } from '../../src/features';

afterEach(() => vi.unstubAllEnvs());

describe('leanFused', () => {
  it('웹도 아이폰 앱(--mode app)도 켜고, VITE_LEAN_FUSED=off 면 끈다', () => {
    vi.stubEnv('MODE', 'production');
    expect(leanFused()).toBe(true);
    vi.stubEnv('MODE', 'app');
    expect(leanFused()).toBe(true);
    vi.stubEnv('VITE_LEAN_FUSED', 'off');
    expect(leanFused()).toBe(false);
  });
});

describe('zeroLean', () => {
  it('주행 준비 중이 아니면 0점을 맞출 수 없다', async () => {
    const { zeroLean } = await import('../../src/app/drive');
    expect(zeroLean()).toBe(false);
  });
});
