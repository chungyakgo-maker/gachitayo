// 바이크 기울기 합치기 (2026-11-19 세영 "기울기가 부정확해 … 0에서도 기울기 동작하게끔해", 웹 빌드에서 시험):
// 기울기 = 폰이 느낀 힘의 방향이 똑바로(0점)에서 기운 각도 + 도는 힘으로 계산한 각도
import { describe, expect, it } from 'vitest';
import { LeanFusion, tiltDegAbout } from '../../src/engine/derive/leanFusion';
import type { Vec3 } from '../../src/engine/linalg';

const G = 9.80665;
const RAD = Math.PI / 180;
/** 폰 화면이 타는 사람을 보는 거치: 기기 x = 오른쪽, y = 위, z = 타는 사람 쪽 → 바이크 앞 = −z */
const FWD: Vec3 = [0, 0, -1];
/** 바이크가 오른쪽으로 θ 기울었을 때, 정차 중 폰이 느끼는 힘(중력의 반작용, 위쪽)을 기기 축으로 */
const restForce = (deg: number): Vec3 => [-G * Math.sin(deg * RAD), G * Math.cos(deg * RAD), 0];
/** 코너를 깔끔하게 돌 때(힘과 바이크 위 방향이 같다): 기울기와 상관없이 폰은 똑바로 선 것처럼 느낀다 */
const turnForce = (deg: number): Vec3 => [0, G / Math.cos(deg * RAD), 0];

function run(f: LeanFusion, ms: number, force: Vec3, opts: { v?: number; yawLeft?: number | null; physicsDeg?: number | null; t0?: number } = {}) {
  const t0 = opts.t0 ?? 0;
  let out = f.update(t0, { v: 0, yawRateLeft: null, physicsDeg: null });
  for (let t = t0; t <= t0 + ms; t += 20) {
    f.pushMotion(t, force);
    out = f.update(t, { v: opts.v ?? 0, yawRateLeft: opts.yawLeft ?? null, physicsDeg: opts.physicsDeg ?? null });
  }
  return out;
}

describe('기울기 각도 (축 둘레)', () => {
  it('오른쪽 + , 왼쪽 − , 앞뒤로 숙인 것(축 방향 성분)은 무시', () => {
    expect(tiltDegAbout(FWD, restForce(0), restForce(20))).toBeCloseTo(20, 6);
    expect(tiltDegAbout(FWD, restForce(0), restForce(-35))).toBeCloseTo(-35, 6);
    // 앞으로 10° 숙임(브레이크·내리막): z 성분만 생긴다 → 기울기 아님
    const pitched: Vec3 = [0, G * Math.cos(10 * RAD), -G * Math.sin(10 * RAD)];
    expect(tiltDegAbout(FWD, restForce(0), pitched)).toBeCloseTo(0, 6);
  });
});

describe('정차·저속에서도 기울기 (폰 센서)', () => {
  it('0점을 맞춘 뒤 바이크를 오른쪽으로 15° 기울이면 15°, 속도 0', () => {
    const f = new LeanFusion();
    run(f, 600, restForce(0));
    expect(f.zero()).toBe(true);
    const out = run(f, 1500, restForce(15), { t0: 700 });
    expect(out.ref).toBe('user');
    expect(out.tiltDeg).toBeCloseTo(15, 0);
    expect(out.physicsDeg).toBe(0);
    expect(out.deg).toBeCloseTo(15, 0);
  });

  it('폰이 비스듬히 달려 있어도(거치 각도 8°) 0점 기준으로 잰다', () => {
    const f = new LeanFusion();
    run(f, 600, restForce(8));
    f.zero();
    const out = run(f, 1500, restForce(8 - 20), { t0: 700 });
    expect(out.deg).toBeCloseTo(-20, 0);
  });

  it('0점이 없고 정차 기준만 있으면 그 기준으로, 아무 기준도 없으면 센서 쪽은 0', () => {
    const none = new LeanFusion();
    expect(run(none, 1000, restForce(10)).ref).toBe('none');
    expect(run(none, 1000, restForce(10), { t0: 1100 }).tiltDeg).toBe(0);
    const still = new LeanFusion();
    still.setAxes({ fwd: null, stillUp: [0, 1, 0] });
    const out = run(still, 1500, restForce(10));
    expect(out.ref).toBe('still');
    expect(out.deg).toBeCloseTo(10, 0);
  });

  it('센서 값이 없으면(모션 없음) 0점을 맞출 수 없다', () => {
    expect(new LeanFusion().zero()).toBe(false);
  });
});

describe('달릴 때: 계산 기울기 + 센서 기울기', () => {
  it('깔끔한 코너(폰은 똑바로 느낌): 계산값 그대로 — 자이로로 도는 빠르기', () => {
    const f = new LeanFusion();
    run(f, 600, restForce(0));
    f.zero();
    const v = 20;
    const yaw = -(Math.tan(30 * RAD) * G) / v; // 오른쪽으로 돈다
    const out = run(f, 2000, turnForce(30), { v, yawLeft: yaw, t0: 700 });
    expect(out.physicsDeg).toBeCloseTo(30, 0);
    expect(out.tiltDeg).toBeCloseTo(0, 0);
    expect(out.deg).toBeCloseTo(30, 0);
  });

  it('몸을 안쪽으로 빼 바이크는 덜 누우면(센서 −5°) 합쳐서 25°', () => {
    const f = new LeanFusion();
    run(f, 600, restForce(0));
    f.zero();
    const v = 20;
    const yaw = -(Math.tan(30 * RAD) * G) / v;
    // 바이크 위 방향이 힘 방향보다 5° 덜 누움 → 폰은 왼쪽 5° 기운 것처럼 느낀다
    const out = run(f, 2000, restForce(-5).map((x) => x / Math.cos(30 * RAD)) as Vec3, { v, yawLeft: yaw, t0: 700 });
    expect(out.deg).toBeCloseTo(25, 0);
  });

  it('자이로를 못 믿을 때는 GPS로 구한 계산값(physicsDeg)을 그대로 쓴다', () => {
    const f = new LeanFusion();
    run(f, 600, restForce(0));
    f.zero();
    const out = run(f, 1500, turnForce(22), { v: 20, yawLeft: null, physicsDeg: 22, t0: 700 });
    expect(out.deg).toBeCloseTo(22, 0);
  });

  it('아주 느릴 때(시속 5km 미만) GPS 계산값은 쓰지 않는다 (방향 잡음)', () => {
    const f = new LeanFusion();
    run(f, 600, restForce(0));
    f.zero();
    const out = run(f, 1500, restForce(0), { v: 1, yawLeft: null, physicsDeg: 40, t0: 700 });
    expect(out.physicsDeg).toBe(0);
  });

  it('60°를 넘게 보이지 않는다', () => {
    const f = new LeanFusion();
    run(f, 600, restForce(0));
    f.zero();
    const d = run(f, 1500, restForce(80), { t0: 700 }).deg;
    expect(d).toBeLessThanOrEqual(60);
    expect(d).toBeGreaterThan(59.9);
  });
});

describe('자동 0점: 빠르게 곧게 달릴 때 바이크는 똑바로 선다', () => {
  it('0점을 안 맞춰도 시속 20km 넘게 곧게 5초 넘게 달리면 그때 자세를 0점으로', () => {
    const f = new LeanFusion();
    f.setAxes({ fwd: null, stillUp: [0, 1, 0] });
    // 폰이 오른쪽으로 6° 비스듬히 달려 있다 (정차 기준으로는 6°로 보인다)
    const straight = run(f, 8000, restForce(6), { v: 25, yawLeft: 0 });
    expect(straight.ref).toBe('auto');
    expect(straight.tiltDeg).toBeCloseTo(0, 0);
    // 그 뒤 정차해서 오른쪽으로 10° 기울이면 10°
    const out = run(f, 1500, restForce(16), { t0: 8100 });
    expect(out.deg).toBeCloseTo(10, 0);
  });

  it('직접 맞춘 0점이 자동보다 앞선다', () => {
    const f = new LeanFusion();
    run(f, 600, restForce(0));
    f.zero();
    const out = run(f, 8000, restForce(6), { v: 25, yawLeft: 0, t0: 700 });
    expect(out.ref).toBe('user');
    expect(out.deg).toBeCloseTo(6, 0);
  });
});

describe('기울기 축', () => {
  it('거치 보정으로 앞 방향을 알면 그 축으로 잰다 (폰이 가로로 달려 있어도)', () => {
    const f = new LeanFusion();
    // 가로 거치: 기기 x 가 위, y 가 왼쪽 — 그래도 화면은 타는 사람 쪽(앞 = −z)
    const land = (deg: number): Vec3 => [G * Math.cos(deg * RAD), G * Math.sin(deg * RAD), 0];
    f.setAxes({ fwd: [0, 0, -1], stillUp: null });
    run(f, 600, land(0));
    f.zero();
    expect(run(f, 1500, land(12), { t0: 700 }).deg).toBeCloseTo(12, 0);
  });
});
