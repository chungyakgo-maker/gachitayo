import { describe, expect, it } from 'vitest';
import { CarEkf } from '../../src/engine/fusion/ekf';
import { gaussian, mulberry32 } from '../generators';

describe('CarEkf (사양서 7.3)', () => {
  it('GPS만으로도 직선 등속 주행에 수렴한다', () => {
    const rng = mulberry32(1);
    const ekf = new CarEkf();
    ekf.init(0, 0, Math.PI / 2, 0);
    for (let s = 1; s <= 30; s++) {
      for (let k = 0; k < 50; k++) ekf.predict(0, 0, 0.02, 'gps_only');
      ekf.updatePosition(10 * s + gaussian(rng) * 3, gaussian(rng) * 3, 3);
      ekf.updateSpeed(10 + gaussian(rng) * 0.2, 0.3);
      ekf.updateHeading(gaussian(rng) * 0.03, 0.05);
    }
    const [x, y, psi, v] = ekf.state();
    expect(Math.abs(v! - 10)).toBeLessThan(0.5);
    expect(Math.abs(psi!)).toBeLessThan((5 * Math.PI) / 180);
    expect(Math.hypot(x! - 300, y!)).toBeLessThan(3);
  });

  it('방향이 +π를 넘으면 −π 쪽으로 이어지고, 관측 차이도 짧은 쪽으로 계산한다', () => {
    const ekf = new CarEkf();
    ekf.init(0, 0, Math.PI - 0.01, 10);
    for (let k = 0; k < 5; k++) ekf.predict(0, 0.5, 0.02, 'imu');
    expect(ekf.state()[2]).toBeCloseTo(-Math.PI + 0.04, 6);
    ekf.updateHeading(-Math.PI + 0.05, 0.05);
    expect(ekf.state()[2]).toBeGreaterThan(-Math.PI + 0.03);
    expect(ekf.state()[2]).toBeLessThan(-Math.PI + 0.06);
  });

  function converged(): CarEkf {
    const ekf = new CarEkf();
    ekf.init(0, 0, 0, 10);
    for (let s = 1; s <= 20; s++) {
      for (let k = 0; k < 50; k++) ekf.predict(0, 0, 0.02, 'imu');
      ekf.updatePosition(10 * s, 0, 2);
      ekf.updateSpeed(10, 0.3);
    }
    return ekf;
  }

  it('예측 위치에서 3σ 넘게 떨어진 GPS 점(50 m 튀는 점)은 버린다', () => {
    const ekf = converged();
    const before = ekf.state().slice(0, 2);
    expect(ekf.updatePosition(200 + 50, 0, 2)).toBe('rejected');
    const after = ekf.state();
    expect(Math.hypot(after[0]! - before[0]!, after[1]! - before[1]!)).toBeLessThan(2);
  });

  it('30초 끊겼다 돌아온 GPS는 받아들인다', () => {
    const ekf = converged();
    for (let k = 0; k < 30 * 50; k++) ekf.predict(0, 0, 0.02, 'imu');
    expect(ekf.updatePosition(500 + 20, 15, 2)).toBe('accepted');
  });

  it('연속 3번 버려지면 다음 GPS로 위치를 다시 맞춘다 (필터가 틀어져도 회복)', () => {
    const ekf = converged();
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 50; k++) ekf.predict(0, 0, 0.02, 'imu');
      expect(ekf.updatePosition(1000, 1000, 2)).toBe('rejected');
    }
    for (let k = 0; k < 50; k++) ekf.predict(0, 0, 0.02, 'imu');
    expect(ekf.updatePosition(1000, 1000, 2)).toBe('reset');
    const [x, y] = ekf.state();
    expect(Math.hypot(x! - 1000, y! - 1000)).toBeLessThan(0.01);
  });
});
