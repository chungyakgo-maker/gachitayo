// 확장 칼만 필터 (사양서 7.3)
// 상태: x, y (m, 동·북), ψ (동쪽 기준 반시계 rad), v (m/s), b (앞 방향 가속도 바이어스 m/s²)
// 예측: 50 Hz로 앞 방향 가속도(ax − b)와 요레이트를 적분한다.
// 관측: GPS 위치(이상치 3σ 버림), GPS 속도, GPS 방향.
import { config } from '../config';
import { wrapAngle } from '../linalg';

export type FusionMode = 'imu' | 'imu_no_gyro' | 'gps_only';
export type PositionUpdate = 'accepted' | 'rejected' | 'reset';

const N = 5;
const cfg = config.fusion;

/** C = A · B (5×5) */
function mul(a: Float64Array, b: Float64Array, out: Float64Array): Float64Array {
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let k = 0; k < N; k++) s += a[i * N + k]! * b[k * N + j]!;
      out[i * N + j] = s;
    }
  return out;
}

function mulT(a: Float64Array, b: Float64Array, out: Float64Array): Float64Array {
  // out = A · Bᵀ
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let k = 0; k < N; k++) s += a[i * N + k]! * b[j * N + k]!;
      out[i * N + j] = s;
    }
  return out;
}

function symmetrize(p: Float64Array): void {
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++) {
      const v = (p[i * N + j]! + p[j * N + i]!) / 2;
      p[i * N + j] = v;
      p[j * N + i] = v;
    }
}

export class CarEkf {
  readonly x = new Float64Array(N);
  readonly P = new Float64Array(N * N);
  /** 마지막 예측의 야코비안 F (RTS 스무더용) */
  readonly F = new Float64Array(N * N);
  private rejects = 0;
  private readonly tmp = new Float64Array(N * N);
  private readonly tmp2 = new Float64Array(N * N);

  init(x: number, y: number, psi: number | null, v: number | null, posSigma: number = cfg.init.posSigmaM): void {
    this.x.set([x, y, psi ?? 0, v ?? 0, 0]);
    this.P.fill(0);
    this.P[0] = posSigma ** 2;
    this.P[6] = posSigma ** 2;
    this.P[12] = (psi === null ? cfg.init.psiUnknownRad : cfg.init.psiKnownRad) ** 2;
    this.P[18] = (v === null ? cfg.init.vUnknownMps : cfg.init.vKnownMps) ** 2;
    this.P[24] = cfg.init.b ** 2;
    this.F.fill(0);
    for (let i = 0; i < N; i++) this.F[i * N + i] = 1;
    this.rejects = 0;
  }

  /** dt 초 만큼 예측. mode에 따라 가속도·요레이트를 쓰는지와 과정 잡음이 달라진다 */
  predict(ax: number, yawRate: number, dt: number, mode: FusionMode): void {
    const [px, py, psi, v, b] = this.x as unknown as [number, number, number, number, number];
    const c = Math.cos(psi);
    const s = Math.sin(psi);
    const useAccel = mode !== 'gps_only';
    const useGyro = mode === 'imu';
    const a = useAccel ? ax - b : 0;
    const w = useGyro ? yawRate : 0;
    this.x[0] = px + v * c * dt;
    this.x[1] = py + v * s * dt;
    this.x[2] = wrapAngle(psi + w * dt);
    this.x[3] = v + a * dt;

    const F = this.F;
    F.fill(0);
    for (let i = 0; i < N; i++) F[i * N + i] = 1;
    F[0 * N + 2] = -v * s * dt;
    F[0 * N + 3] = c * dt;
    F[1 * N + 2] = v * c * dt;
    F[1 * N + 3] = s * dt;
    if (useAccel) F[3 * N + 4] = -dt;

    mulT(mul(F, this.P, this.tmp), F, this.tmp2);
    this.P.set(this.tmp2);
    const q = mode === 'imu' ? cfg.q.imu : mode === 'imu_no_gyro' ? cfg.q.imuNoGyro : cfg.q.gpsOnly;
    this.P[0] += q.pos * dt;
    this.P[6] += q.pos * dt;
    this.P[12] += q.psi * dt;
    this.P[18] += q.v * dt;
    this.P[24] += q.b * dt;
  }

  /**
   * GPS 위치 관측. 예측에서 3σ 넘게 떨어지면 버리고, 연속으로 버려지면 위치를 다시 맞춘다.
   * gate=false면 이상치 검사 없이 받아들인다 (오래 끊겼다 돌아온 첫 점: 예측이 크게 벗어나 있어도 상관관계를 지킨 채 끌어온다).
   */
  updatePosition(zx: number, zy: number, sigma: number, gate = true): PositionUpdate {
    const P = this.P;
    const r = sigma * sigma;
    const s00 = P[0]! + r;
    const s01 = P[1]!;
    const s11 = P[6]! + r;
    const det = s00 * s11 - s01 * s01;
    const i00 = s11 / det;
    const i01 = -s01 / det;
    const i11 = s00 / det;
    const n0 = zx - this.x[0]!;
    const n1 = zy - this.x[1]!;
    const d2 = n0 * (i00 * n0 + i01 * n1) + n1 * (i01 * n0 + i11 * n1);
    if (gate && d2 > cfg.outlierSigma ** 2) {
      if (this.rejects >= cfg.maxConsecutiveRejects) {
        this.resetPosition(zx, zy, sigma);
        return 'reset';
      }
      this.rejects += 1;
      return 'rejected';
    }
    this.rejects = 0;
    // K = P Hᵀ S⁻¹ (5×2)
    const K = new Float64Array(N * 2);
    for (let i = 0; i < N; i++) {
      const p0 = P[i * N]!;
      const p1 = P[i * N + 1]!;
      K[i * 2] = p0 * i00 + p1 * i01;
      K[i * 2 + 1] = p0 * i01 + p1 * i11;
    }
    for (let i = 0; i < N; i++) this.x[i] += K[i * 2]! * n0 + K[i * 2 + 1]! * n1;
    // P = P − K (H P)
    const hp0 = P.slice(0, N);
    const hp1 = P.slice(N, 2 * N);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) P[i * N + j] -= K[i * 2]! * hp0[j]! + K[i * 2 + 1]! * hp1[j]!;
    symmetrize(P);
    this.x[2] = wrapAngle(this.x[2]!);
    return 'accepted';
  }

  updateSpeed(z: number, sigma: number): void {
    this.scalarUpdate(3, z - this.x[3]!, sigma * sigma);
  }

  updateHeading(psi: number, sigma: number): void {
    this.scalarUpdate(2, wrapAngle(psi - this.x[2]!), sigma * sigma);
    this.x[2] = wrapAngle(this.x[2]!);
  }

  state(): Float64Array {
    return this.x.slice();
  }

  cov(): Float64Array {
    return this.P.slice();
  }

  /** 위치 표준편차 (축 평균) */
  positionSigma(): number {
    return Math.sqrt((this.P[0]! + this.P[6]!) / 2);
  }

  private scalarUpdate(i: number, nu: number, r: number): void {
    const P = this.P;
    const s = P[i * N + i]! + r;
    const K = new Float64Array(N);
    for (let k = 0; k < N; k++) K[k] = P[k * N + i]! / s;
    for (let k = 0; k < N; k++) this.x[k] += K[k]! * nu;
    const hp = new Float64Array(N);
    for (let k = 0; k < N; k++) hp[k] = P[i * N + k]!;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) P[a * N + b] -= K[a]! * hp[b]!;
    symmetrize(P);
  }

  private resetPosition(zx: number, zy: number, sigma: number): void {
    this.x[0] = zx;
    this.x[1] = zy;
    for (let k = 0; k < N; k++) {
      this.P[k] = 0;
      this.P[k * N] = 0;
      this.P[N + k] = 0;
      this.P[k * N + 1] = 0;
    }
    this.P[0] = sigma * sigma;
    this.P[6] = sigma * sigma;
    this.rejects = 0;
  }
}
