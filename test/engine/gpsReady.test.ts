import { describe, expect, it } from 'vitest';
import { GpsReadiness } from '../../src/engine/fusion/gpsReady';

describe('GPS 준비 판정 (사양서 7.4)', () => {
  it('정확도 10 m 이하 fix가 5개 연속이면 준비 완료', () => {
    const r = new GpsReadiness();
    expect([12, 9, 8, 7, 10].map((h) => r.push({ hAcc: h }))).toEqual([false, false, false, false, false]);
    expect(r.push({ hAcc: 6 })).toBe(true);
    expect(r.ready).toBe(true);
  });

  it('중간에 나쁜 값이 오면 다시 센다', () => {
    const r = new GpsReadiness();
    [5, 5, 5, 5].forEach((h) => r.push({ hAcc: h }));
    expect(r.push({ hAcc: 25 })).toBe(false);
    [5, 5, 5, 5].forEach((h) => r.push({ hAcc: h }));
    expect(r.ready).toBe(false);
    expect(r.push({ hAcc: 5 })).toBe(true);
  });
});
