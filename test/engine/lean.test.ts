// 바이크 기울기 추정 (2026-11-18 바이크 모드): tan θ = 속도 × 도는 빠르기 / 중력
import { describe, expect, it } from 'vitest';
import { LEAN, LeanEstimator, leanDegOf, maxLeanOf } from '../../src/engine/derive/lean';

const G = 9.80665;
/** 반지름 r(m) 원을 속도 v(m/s)로 도는 10 Hz 진행 방향 (left: 왼쪽으로 돈다) */
function circle(v: number, r: number, seconds: number, left: boolean) {
  const out: Array<{ t: number; v: number; psi: number }> = [];
  const w = (left ? 1 : -1) * (v / r);
  for (let i = 0; i <= seconds * 10; i++) out.push({ t: i * 100, v, psi: w * (i / 10) });
  return out;
}

describe('기울기 계산', () => {
  it('물리식: 60 km/h로 반지름 50 m 왼쪽 코너 → 왼쪽 약 29.5°', () => {
    const v = 60 / 3.6;
    const want = (Math.atan((v * v) / 50 / G) * 180) / Math.PI;
    expect(leanDegOf(v, v / 50)).toBeCloseTo(-want, 5);
    expect(leanDegOf(v, -v / 50)).toBeCloseTo(want, 5);
    expect(leanDegOf(v, 0)).toBeCloseTo(0, 5);
  });

  it('원을 계속 돌면 그 각도로 모인다 (왼쪽 −, 오른쪽 +)', () => {
    const v = 60 / 3.6;
    const want = (Math.atan((v * v) / 50 / G) * 180) / Math.PI;
    for (const left of [true, false]) {
      const e = new LeanEstimator();
      let d = 0;
      for (const p of circle(v, 50, 3, left)) d = e.push(p.t, p.v, p.psi);
      expect(d).toBeCloseTo(left ? -want : want, 0);
    }
  });

  it('GPS만 쓸 때(진행 방향이 1초마다 계단)도 출렁이지 않는다 (검토 지적: 예전 0.5초 차이는 실제 30°가 6°~43°)', () => {
    const v = 20;
    const w = (Math.tan(Math.PI / 6) * G) / v;
    const e = new LeanEstimator();
    const seen: number[] = [];
    for (let i = 0; i <= 600; i++) {
      const t = i * 20;
      const d = e.push(t, v, -w * Math.floor(t / 1000)); // 오른쪽으로 돈다, 1초마다 계단
      if (t > 4000) seen.push(d);
    }
    expect(Math.min(...seen)).toBeGreaterThan(27);
    expect(Math.max(...seen)).toBeLessThan(33);
  });

  it('진행 방향이 ±180°를 넘어가도 끊기지 않는다', () => {
    const v = 60 / 3.6;
    const e = new LeanEstimator();
    let d = 0;
    // 왼쪽으로 계속 돌며 π를 여러 번 넘는다 (wrap된 값으로 넣는다)
    for (const p of circle(v, 50, 25, true)) d = e.push(p.t, p.v, Math.atan2(Math.sin(p.psi), Math.cos(p.psi)));
    expect(d).toBeCloseTo(-(Math.atan((v * v) / 50 / G) * 180) / Math.PI, 0);
  });

  it('느리면 0 (15 km/h 미만, 주차장·유턴)', () => {
    const e = new LeanEstimator();
    let d = 1;
    for (const p of circle(10 / 3.6, 3, 3, true)) d = e.push(p.t, p.v, p.psi);
    expect(d).toBe(0);
  });

  it('잡음으로 튀어도 60°를 넘지 않는다', () => {
    const e = new LeanEstimator();
    let d = 0;
    for (const p of circle(100 / 3.6, 5, 5, false)) d = e.push(p.t, p.v, p.psi);
    expect(d).toBeLessThanOrEqual(LEAN.maxDeg);
    expect(d).toBeCloseTo(LEAN.maxDeg, 3);
  });

  it('주행 요약: 처리된 궤적(나침반 방향)에서 왼쪽·오른쪽 최대', () => {
    const v = 60 / 3.6;
    const t: number[] = [];
    const speed: number[] = [];
    const heading: number[] = [];
    // 3초 오른쪽(나침반 방향이 늘어난다, 반지름 50 m) → 3초 왼쪽(반지름 80 m)
    let h = 0;
    for (let i = 0; i < 60; i++) {
      t.push(i * 100);
      speed.push(v);
      heading.push(h);
      h += ((i < 30 ? v / 50 : -v / 80) * 0.1 * 180) / Math.PI;
    }
    const m = maxLeanOf({ t, speed, heading })!;
    expect(m.rightDeg).toBe(Math.round((Math.atan((v * v) / 50 / G) * 180) / Math.PI));
    expect(m.leftDeg).toBeGreaterThan(15);
    expect(m.leftDeg).toBeLessThanOrEqual(Math.round((Math.atan((v * v) / 80 / G) * 180) / Math.PI));
    expect(maxLeanOf({ t: [0, 100], speed: [1, 1], heading: [0, 90] })).toBeNull();
  });
});
