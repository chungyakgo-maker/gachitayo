import { describe, expect, it } from 'vitest';
import { GpsAccelEstimator } from '../../src/engine/derive/gpsAccel';

describe('보정 전 임시 G (GPS 속도·진행 방향 변화)', () => {
  it('정차면 0, 0', () => {
    const e = new GpsAccelEstimator();
    let r = { ax: 1, ay: 1 };
    for (let t = 0; t <= 2000; t += 20) r = e.push(t, 0, 1.2);
    expect(r).toEqual({ ax: 0, ay: 0 });
  });

  it('1 s 동안 3 m/s² 가속하면 앞 +3, 제동은 −', () => {
    const e = new GpsAccelEstimator();
    let r = { ax: 0, ay: 0 };
    for (let t = 0; t <= 2000; t += 20) r = e.push(t, 10 + (3 * t) / 1000, 0);
    expect(r.ax).toBeCloseTo(3, 5);
    expect(r.ay).toBeCloseTo(0, 5);
    const b = new GpsAccelEstimator();
    for (let t = 0; t <= 2000; t += 20) r = b.push(t, 30 - (6 * t) / 1000, 0);
    expect(r.ax).toBeCloseTo(-6, 5);
  });

  it('왼쪽 원 돌기: 좌우 = v²/R (왼쪽 +), 오른쪽은 −', () => {
    const v = 20;
    const R = 80;
    const yaw = v / R;
    const left = new GpsAccelEstimator();
    let r = { ax: 0, ay: 0 };
    for (let t = 0; t <= 3000; t += 20) r = left.push(t, v, Math.PI - 0.1 + (yaw * t) / 1000);
    expect(r.ay).toBeCloseTo((v * v) / R, 3);
    const right = new GpsAccelEstimator();
    for (let t = 0; t <= 3000; t += 20) r = right.push(t, v, 3 - (yaw * t) / 1000);
    expect(r.ay).toBeCloseTo(-(v * v) / R, 3);
  });

  it('출발 직후(0.2초 미만)는 0, 튀는 값은 ±12 m/s²로 자른다', () => {
    const e = new GpsAccelEstimator();
    expect(e.push(0, 0, 0)).toEqual({ ax: 0, ay: 0 });
    expect(e.push(100, 30, 0)).toEqual({ ax: 0, ay: 0 });
    expect(e.push(300, 60, 0).ax).toBe(12);
  });
});
