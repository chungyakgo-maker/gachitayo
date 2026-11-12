import { describe, expect, it } from 'vitest';
import { resampleMotion } from '../../src/normalize/resample';
import type { RawMotionSample } from '../../src/types/samples';

const sample = (t: number, gyro = true): RawMotionSample => ({
  t,
  gax: 0.01 * t,
  gay: 1,
  gaz: 9.8,
  rx: gyro ? 0.001 * t : null,
  ry: gyro ? 0 : null,
  rz: gyro ? -0.5 : null,
});

/** 약 60 Hz, 간격이 조금씩 흔들리는 샘플 */
function irregular(fromMs: number, toMs: number, gyro = true): RawMotionSample[] {
  const out: RawMotionSample[] = [];
  let i = 0;
  for (let t = fromMs; t <= toMs; t += 16.7 + ((i++ % 3) - 1) * 2) out.push(sample(t, gyro));
  return out;
}

describe('resampleMotion (사양서 6.3: 50 Hz 선형 보간)', () => {
  it('20 ms 간격 격자에 선형 보간한다', () => {
    const m = resampleMotion(irregular(3, 2003));
    expect(m.dt).toBe(20);
    expect(m.t0 % 20).toBe(0);
    expect(m.n).toBeGreaterThan(95);
    for (let i = 0; i < m.n; i++) {
      const t = m.t0 + i * m.dt;
      expect(m.valid[i]).toBe(1);
      expect(m.fx[i]).toBeCloseTo(0.01 * t, 9);
      expect(m.wx[i]).toBeCloseTo(0.001 * t, 9);
    }
    expect(m.hasGyro).toBe(true);
  });

  it('200 ms 넘게 비어 있는 구간은 보간으로 메우지 않는다', () => {
    const m = resampleMotion([...irregular(0, 1000), ...irregular(1600, 2600)]);
    const at = (t: number) => (t - m.t0) / m.dt;
    expect(m.valid[at(1300)]).toBe(0);
    expect(m.valid[at(900)]).toBe(1);
    expect(m.valid[at(1800)]).toBe(1);
  });

  it('플랫폼 부호를 곱한다', () => {
    const m = resampleMotion(irregular(0, 500), { accel: -1, gyro: -1 });
    const i = 10;
    const t = m.t0 + i * m.dt;
    expect(m.fx[i]).toBeCloseTo(-0.01 * t, 9);
    expect(m.fz[i]).toBeCloseTo(-9.8, 9);
    expect(m.wz[i]).toBeCloseTo(0.5, 9);
  });

  it('자이로가 없으면 hasGyro는 false', () => {
    expect(resampleMotion(irregular(0, 500, false)).hasGyro).toBe(false);
  });

  it('샘플이 없으면 빈 결과', () => {
    expect(resampleMotion([]).n).toBe(0);
  });
});
