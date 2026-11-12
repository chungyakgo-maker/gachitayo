import { describe, expect, it } from 'vitest';
import { compareSeries, lapPointAt, nearestLapPoint, speedColor } from '../../../src/ui/analysis/compare';
import type { ProcessedTrack } from '../../../src/engine/process/processDrive';

const trace = (v: number[], stepM = 5) => {
  const t = [0];
  for (let i = 1; i < v.length; i++) t.push(t[i - 1]! + stepM / ((v[i - 1]! + v[i]!) / 2));
  return { stepM, t, v, alt: v.map((_, i) => 100 + i) };
};

describe('두 랩 비교 (사양서 8.6)', () => {
  it('가로축은 코스 거리, 속도는 km/h, 델타 = A의 시각 − B의 시각 (A가 느리면 +)', () => {
    const a = trace([20, 20, 20, 20, 20]);
    const b = trace([25, 25, 25, 25]);
    const c = compareSeries(a, b);
    expect(c.x).toEqual([0, 5, 10, 15, 20]);
    expect(c.speedA[0]).toBeCloseTo(72, 6);
    expect(c.speedB[0]).toBeCloseTo(90, 6);
    expect(c.speedB[4]).toBeNull(); // B가 짧으면 빈칸
    expect(c.delta[3]).toBeCloseTo(15 / 20 - 15 / 25, 6);
    expect(c.delta[4]).toBeNull();
    expect(c.altA[2]).toBe(102);
    const solo = compareSeries(a, null);
    expect(solo.speedB.every((v) => v === null)).toBe(true);
    expect(solo.delta.every((v) => v === null)).toBe(true);
  });

  it('지점 정보: 그 랩에서 코스 거리가 가장 가까운 처리된 궤적 점, 지도에서 누르면 가장 가까운 점', () => {
    const p: ProcessedTrack = {
      hz: 10,
      n: 6,
      t: [0, 100, 200, 300, 400, 500],
      utc: [1, 2, 3, 4, 5, 6],
      lat: [37, 37.0001, 37.0002, 37.0003, 37.0004, 37.0005],
      lon: [127, 127, 127, 127, 127, 127],
      alt: [10, 11, 12, 13, 14, 15],
      speed: [20, 20, 21, 22, 23, 24],
      heading: [0, 0, 0, 0, 0, 0],
      ax: [0, 0, 0, 0, 0, 0],
      ay: [0, 0, 0, 0, 0, 0],
      s: [null, 0, 2, 4, 6, null],
      lapNo: [0, 1, 1, 1, 1, 0],
      hAcc: [5, 5, 5, 5, 5, 5],
    };
    expect(lapPointAt(p, 1, 4.6)).toBe(3);
    expect(lapPointAt(p, 2, 4)).toBeNull();
    expect(nearestLapPoint(p, 1, 37.00038, 127)).toBe(4);
  });

  it('속도 색: 느림 → 빠름으로 파랑 → 초록 → 노랑 → 빨강', () => {
    expect(speedColor(0, 0, 100)).toBe('hsl(220, 85%, 55%)');
    expect(speedColor(100, 0, 100)).toBe('hsl(0, 85%, 55%)');
    expect(speedColor(50, 0, 100)).toBe('hsl(110, 85%, 55%)');
    expect(speedColor(150, 0, 100)).toBe('hsl(0, 85%, 55%)');
  });
});
