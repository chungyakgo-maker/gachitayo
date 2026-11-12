import { describe, expect, it } from 'vitest';
import { SensorGEstimator } from '../../src/engine/derive/sensorG';

const G = 9.80665;
/** 세로로 세워 화면이 운전석을 보게 거치(W3C 부호): 기기 y = 위, z = 운전석 쪽(뒤), x = 오른쪽 */
const portrait = (A: number, L: number, sign = 1) => [sign * -L, sign * G, sign * -A] as [number, number, number];

describe('보정 전 임시 G — 폰 센서 그대로 (사용자 요청: 흔들면 움직이게)', () => {
  it('세로 거치: 앞 가속 +, 왼쪽 +로 바로 나온다', () => {
    const e = new SensorGEstimator();
    for (let t = 0; t < 5000; t += 20) e.push(t, portrait(0, 0));
    const r = e.push(5000, portrait(3, 0));
    expect(r.ax).toBeCloseTo(3, 0);
    expect(Math.abs(r.ay)).toBeLessThan(0.2);
    const l = e.push(5020, portrait(0, 4));
    expect(l.ay).toBeCloseTo(4, 0);
  });

  it('손으로 흔들면(정차 중) 바로 값이 나온다', () => {
    const e = new SensorGEstimator();
    let maxA = 0;
    for (let t = 0; t < 4000; t += 20) {
      const s = 3 * Math.sin((2 * Math.PI * 3 * t) / 1000);
      const r = e.push(t, [s, G, 0.5 * s]);
      if (t > 1000) maxA = Math.max(maxA, Math.hypot(r.ax, r.ay));
    }
    expect(maxA).toBeGreaterThan(2);
  });

  it('부호가 반대인 기기(아이폰 흉내)도 GPS 가속도와 1초 넘게 비교하면 앞뒤·좌우 부호를 맞춘다', () => {
    const e = new SensorGEstimator();
    for (let t = 0; t < 5000; t += 20) e.push(t, portrait(0, 0, -1));
    expect(e.push(5000, portrait(2, 0, -1), { }, null).ax).toBeLessThan(-1.5);
    let r = { ax: 0, ay: 0 };
    for (let t = 5020; t < 7000; t += 20) r = e.push(t, portrait(2, 0, -1), {}, { ax: 2, ay: 0 });
    expect(r.ax).toBeCloseTo(2, 0);
    for (let t = 7000; t < 9000; t += 20) r = e.push(t, portrait(0, 3, -1), {}, { ax: 0, ay: 3 });
    expect(r.ay).toBeCloseTo(3, 0);
  });

  it('누운 폰은 폰 위쪽(기기 +y)을 앞으로 본다', () => {
    const e = new SensorGEstimator();
    for (let t = 0; t < 5000; t += 20) e.push(t, [0, 0, G]);
    const r = e.push(5000, [0, 2.5, G]);
    expect(r.ax).toBeCloseTo(2.5, 1);
  });

  it('보정기가 위·앞 방향을 잡았으면 그것을 쓴다', () => {
    const e = new SensorGEstimator();
    const r = e.push(0, [1, 0, G + 0.5], { up: [0, 0, 1], gravity: G, fwd: [1, 0, 0], left: [0, 1, 0] });
    expect(r.ax).toBeCloseTo(1, 6);
    expect(r.ay).toBeCloseTo(0, 6);
  });
});
