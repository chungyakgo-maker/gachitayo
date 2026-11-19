// 바이크 기울기 합치기 (2026-11-19 세영 "기울기가 부정확해 … 0에서도 기울기 동작하게끔해", 웹 빌드에서 먼저 시험):
//   기울기 = 센서 기울기 + 계산 기울기
// · 센서 기울기: 폰이 느끼는 힘(중력 + 원심력)의 방향이 "똑바로 선 자세(0점)"에서 앞 방향 축 둘레로 기운 각도.
//   서 있을 때는 이것이 곧 기울기다(속도 0에서도 움직인다).
// · 계산 기울기: tan θ = 속도 × 도는 빠르기 / 중력 (lean.ts). 깔끔한 코너에서는 힘이 바이크 위 방향과 같아
//   폰이 똑바로 선 것처럼 느끼므로 센서 기울기는 0이고, 이 값이 기울기다.
// 둘을 더하면 정차·저속(센서)과 코너(계산)가 이어지고, 몸을 안쪽으로 빼서 바이크가 덜 누운 만큼도 센서 쪽에 잡힌다.
// 도는 빠르기는 자이로를 믿을 수 있으면(거치 보정·축 부호 확인 뒤) 자이로로 — GPS 방향 기울기(1.5초)보다 늦지 않다.
// 켜고 끄기는 features.ts leanFused (웹에서 먼저 시험한 뒤 2026-11-19 정식 앱에도 켬). 재생·모의주행(replayTimeline)은 예전 계산 그대로.
import { cross, dot, norm, normalize, scale, sub, type Vec3 } from '../linalg';
import { LEAN, leanDegOf } from './lean';

export const LEAN_FUSION = {
  /** 폰이 느끼는 힘을 이만큼 부드럽게 (손떨림·노면 진동) */
  forceTauMs: 200,
  /** 화면 값 부드럽게 */
  outTauMs: 150,
  /** GPS로 구한 계산 기울기는 이보다 느리면 쓰지 않는다 (방향 잡음) — 자이로는 속도가 곱해져 저속에서 저절로 작다 */
  gpsPhysicsMinMps: 5 / 3.6,
  /** 자동 0점: 이보다 빠르고 */
  autoMinMps: 20 / 3.6,
  /** 도는 힘(속도 × 도는 빠르기)이 이보다 작을 때 곧게 달린다고 본다 m/s² */
  autoMaxLatMps2: 0.5,
  /** GPS 계산값만 있을 때 곧게 달린다고 보는 계산 기울기 한도 (도) */
  autoMaxPhysicsDeg: 2,
  /** 곧게 이만큼 달려야 자동 0점을 쓴다 */
  autoMinMs: 5000,
  /** 자동 0점은 천천히 따라간다 (긴 직선의 평균 자세) */
  autoTauMs: 20_000,
  /** 기기 축 기본 앞 방향: 화면이 타는 사람을 본다 (기기 z = 화면 밖 = 뒤) */
  defaultFwd: [0, 0, -1] as Vec3,
} as const;

export type LeanRef = 'user' | 'auto' | 'still' | 'none';
export interface LeanParts {
  /** 화면에 보일 기울기 (도, + 오른쪽) */
  deg: number;
  /** 폰 센서로 잰 0점에서 기운 각도 */
  tiltDeg: number;
  /** 속도 × 도는 빠르기로 계산한 각도 */
  physicsDeg: number;
  /** 0점 기준: 직접 맞춤 · 달리며 자동 · 정차 때 위 방향 · 없음 */
  ref: LeanRef;
}
export interface LeanInput {
  /** 속도 m/s */
  v: number;
  /** 자이로로 잰 왼쪽으로 도는 빠르기 rad/s (못 믿으면 null) */
  yawRateLeft: number | null;
  /** 자이로를 못 믿을 때 GPS 방향으로 구한 계산 기울기 (lean.ts LeanEstimator, 없으면 null) */
  physicsDeg: number | null;
}

const DEG = 180 / Math.PI;
const clamp = (d: number) => Math.max(-LEAN.maxDeg, Math.min(LEAN.maxDeg, d));
const ema = (dt: number, tau: number) => 1 - Math.exp(-Math.max(0, dt) / tau);

/** 앞 방향 축 a 둘레로, 기준 위 방향 r 에서 지금 힘 방향 c 까지 → 바이크 기울기 (도, + 오른쪽).
 *  바이크가 축 둘레로 +θ(오른쪽) 돌면 기기에서 본 실제 위 방향은 −θ 돈다. 축 방향 성분(앞뒤로 숙임)은 버린다 */
export function tiltDegAbout(a: Vec3, r: Vec3, c: Vec3): number {
  const ax = normalize(a);
  const rp = sub(r, scale(ax, dot(r, ax)));
  const cp = sub(c, scale(ax, dot(c, ax)));
  if (norm(rp) < 1e-9 || norm(cp) < 1e-9) return 0;
  return -Math.atan2(dot(ax, cross(rp, cp)), dot(rp, cp)) * DEG;
}

export class LeanFusion {
  private force: Vec3 | null = null;
  private forceT: number | null = null;
  private fwd: Vec3 = LEAN_FUSION.defaultFwd;
  private stillUp: Vec3 | null = null;
  private userUp: Vec3 | null = null;
  private autoUp: Vec3 | null = null;
  private autoMs = 0;
  private lastT: number | null = null;
  private out = 0;

  /** 거치 보정에서 아는 축: 앞 방향(없으면 화면이 타는 사람을 본다고 본다), 정차 때 위 방향 */
  setAxes(a: { fwd: Vec3 | null; stillUp: Vec3 | null }): void {
    this.fwd = a.fwd ?? LEAN_FUSION.defaultFwd;
    this.stillUp = a.stillUp;
  }

  /** 모션 한 칸: 폰이 느끼는 힘 (기기 축 m/s², 정차 때 위쪽) */
  pushMotion(t: number, f: Vec3): void {
    if (!f.every(Number.isFinite) || norm(f) < 1) return;
    if (!this.force || this.forceT === null) {
      this.force = f;
    } else {
      const k = ema(t - this.forceT, LEAN_FUSION.forceTauMs);
      this.force = [this.force[0] + (f[0] - this.force[0]) * k, this.force[1] + (f[1] - this.force[1]) * k, this.force[2] + (f[2] - this.force[2]) * k];
    }
    this.forceT = t;
  }

  /** 지금 자세를 0점으로 (바이크를 똑바로 세우고 누른다). 센서 값이 아직 없으면 false */
  zero(): boolean {
    if (!this.force) return false;
    this.userUp = normalize(this.force);
    this.out = 0;
    return true;
  }

  private reference(): { up: Vec3 | null; ref: LeanRef } {
    if (this.userUp) return { up: this.userUp, ref: 'user' };
    if (this.autoUp && this.autoMs >= LEAN_FUSION.autoMinMs) return { up: this.autoUp, ref: 'auto' };
    if (this.stillUp) return { up: this.stillUp, ref: 'still' };
    return { up: null, ref: 'none' };
  }

  update(t: number, inp: LeanInput): LeanParts {
    const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    const v = Math.max(0, inp.v);

    // 계산 기울기: 자이로가 있으면 자이로, 없으면 GPS 계산값 (느리면 버림)
    let physicsDeg = 0;
    if (inp.yawRateLeft !== null && Number.isFinite(inp.yawRateLeft)) physicsDeg = leanDegOf(v, inp.yawRateLeft);
    else if (inp.physicsDeg !== null && v >= LEAN_FUSION.gpsPhysicsMinMps) physicsDeg = inp.physicsDeg;

    // 자동 0점: 빠르게 곧게 달리는 동안의 자세 (바이크가 똑바로 선다)
    const straight =
      inp.yawRateLeft !== null ? Math.abs(v * inp.yawRateLeft) < LEAN_FUSION.autoMaxLatMps2 : inp.physicsDeg !== null && Math.abs(inp.physicsDeg) < LEAN_FUSION.autoMaxPhysicsDeg;
    if (this.force && v >= LEAN_FUSION.autoMinMps && straight && dt > 0) {
      const u = normalize(this.force);
      if (!this.autoUp) this.autoUp = u;
      else {
        // 처음 몇 초는 평균처럼 빨리, 그 뒤로는 천천히 따라간다
        const k = Math.min(1, dt / Math.min(LEAN_FUSION.autoTauMs, this.autoMs + dt));
        this.autoUp = normalize([this.autoUp[0] + (u[0] - this.autoUp[0]) * k, this.autoUp[1] + (u[1] - this.autoUp[1]) * k, this.autoUp[2] + (u[2] - this.autoUp[2]) * k]);
      }
      this.autoMs += dt;
    }

    const { up, ref } = this.reference();
    const tiltDeg = up && this.force ? tiltDegAbout(this.fwd, up, this.force) : 0;
    const raw = clamp(tiltDeg + physicsDeg);
    this.out += (raw - this.out) * (dt === 0 ? 1 : ema(dt, LEAN_FUSION.outTauMs));
    const deg = Math.abs(this.out) < 0.05 ? 0 : clamp(this.out);
    return { deg, tiltDeg, physicsDeg, ref };
  }
}
