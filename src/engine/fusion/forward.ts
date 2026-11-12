// 융합 실행기: 50 Hz 격자에서 EKF를 예측하고, GPS가 들어오면 관측으로 반영한다.
// 주행 중(실시간)과 주행 후(기록해서 RTS 스무더로 넘김)가 같은 코드를 쓴다.
import { config } from '../config';
import type { MountCalibration } from '../../normalize/mount';
import { toCar } from '../../normalize/mount';
import type { Motion50 } from '../../normalize/resample';
import type { GpsObs } from './gpsObs';
import { CarEkf, type FusionMode } from './ekf';

const cfg = config.fusion;
const N = 5;

export interface FusedPoint {
  /** 세션 시계 ms (격자) */
  t: number;
  x: number;
  y: number;
  psi: number;
  v: number;
  /** 위치 표준편차 m */
  sigmaPos: number;
  mode: FusionMode;
}

/** RTS 스무더에 넘기는 기록 */
export interface FusionHistory {
  n: number;
  t0: number;
  dt: number;
  xPred: Float64Array;
  PPred: Float64Array;
  xFilt: Float64Array;
  PFilt: Float64Array;
  /** k번째 예측(k−1 → k)의 야코비안 */
  F: Float64Array;
  mode: Uint8Array;
}

const MODE_CODE: Record<FusionMode, number> = { imu: 0, imu_no_gyro: 1, gps_only: 2 };
export const MODE_FROM_CODE: FusionMode[] = ['imu', 'imu_no_gyro', 'gps_only'];

class GrowableHistory {
  n = 0;
  private cap = 1024;
  xPred = new Float64Array(this.cap * N);
  PPred = new Float64Array(this.cap * N * N);
  xFilt = new Float64Array(this.cap * N);
  PFilt = new Float64Array(this.cap * N * N);
  F = new Float64Array(this.cap * N * N);
  mode = new Uint8Array(this.cap);

  constructor(readonly t0: number, readonly dt: number) {}

  private grow(): void {
    this.cap *= 2;
    const g = <T extends Float64Array | Uint8Array>(a: T, k: number): T => {
      const b = new (a.constructor as new (n: number) => T)(this.cap * k);
      b.set(a);
      return b;
    };
    this.xPred = g(this.xPred, N);
    this.PPred = g(this.PPred, N * N);
    this.xFilt = g(this.xFilt, N);
    this.PFilt = g(this.PFilt, N * N);
    this.F = g(this.F, N * N);
    this.mode = g(this.mode, 1);
  }

  pushPred(ekf: CarEkf, mode: FusionMode): void {
    if (this.n >= this.cap) this.grow();
    this.xPred.set(ekf.x, this.n * N);
    this.PPred.set(ekf.P, this.n * N * N);
    this.F.set(ekf.F, this.n * N * N);
    this.mode[this.n] = MODE_CODE[mode];
  }

  pushFilt(ekf: CarEkf): void {
    this.xFilt.set(ekf.x, this.n * N);
    this.PFilt.set(ekf.P, this.n * N * N);
    this.n += 1;
  }

  snapshot(): FusionHistory {
    return {
      n: this.n,
      t0: this.t0,
      dt: this.dt,
      xPred: this.xPred.subarray(0, this.n * N),
      PPred: this.PPred.subarray(0, this.n * N * N),
      xFilt: this.xFilt.subarray(0, this.n * N),
      PFilt: this.PFilt.subarray(0, this.n * N * N),
      F: this.F.subarray(0, this.n * N * N),
      mode: this.mode.subarray(0, this.n),
    };
  }
}

export interface FusionRunnerOpts {
  m50: Motion50;
  gps?: GpsObs[];
  /** 시각 t의 거치 보정 (없으면 GPS만 모드) */
  calibrationAt: (t: number) => MountCalibration | null;
  /** RTS 스무더용 기록 */
  record?: boolean;
}

export class FusionRunner {
  readonly ekf = new CarEkf();
  private readonly gps: GpsObs[];
  private j = 0;
  private prevGpsT = -Infinity;
  private tGrid: number | null = null;
  private last: FusedPoint | null = null;
  private lastMode: FusionMode = 'gps_only';
  private hist: GrowableHistory | null = null;

  constructor(private readonly opts: FusionRunnerOpts) {
    this.gps = [...(opts.gps ?? [])];
  }

  /** GPS 관측 추가 (시간 순서) */
  pushGps(obs: GpsObs): void {
    this.gps.push(obs);
  }

  current(): FusedPoint | null {
    return this.last;
  }

  history(): FusionHistory | null {
    return this.hist?.snapshot() ?? null;
  }

  /** 시각 t(ms)까지 격자를 진행한다 */
  runTo(t: number): void {
    const step = cfg.stepMs;
    if (this.tGrid === null) {
      const first = this.gps[this.j];
      if (!first || first.t > t) return;
      this.j += 1;
      this.prevGpsT = first.t;
      this.ekf.init(
        first.x,
        first.y,
        first.psi,
        first.speed !== null && !first.speedDerived ? first.speed : null,
        Math.max(cfg.minPosSigmaM, first.hAcc * cfg.hAccToSigma),
      );
      this.tGrid = Math.ceil(first.t / step) * step;
      if (this.opts.record) {
        this.hist = new GrowableHistory(this.tGrid, step);
        this.hist.pushPred(this.ekf, 'gps_only');
        this.hist.pushFilt(this.ekf);
      }
      this.last = this.point(this.tGrid);
    }
    while (this.tGrid + step <= t) {
      const tk: number = this.tGrid + step;
      const input = this.inputAt(this.tGrid);
      this.lastMode = input.mode;
      this.ekf.predict(input.ax, input.yawRate, step / 1000, input.mode);
      this.hist?.pushPred(this.ekf, input.mode);
      while (this.j < this.gps.length && this.gps[this.j]!.t <= tk) this.applyGps(this.gps[this.j++]!, tk);
      this.hist?.pushFilt(this.ekf);
      this.tGrid = tk;
      this.last = this.point(tk);
    }
  }

  private inputAt(t: number): { ax: number; yawRate: number; mode: FusionMode } {
    const m = this.opts.m50;
    const i = Math.round((t - m.t0) / m.dt);
    const cal = this.opts.calibrationAt(t);
    // 보정 확인(앞 방향, 축 부호) 전에는 모션을 쓰지 않는다: 거꾸로 된 가속도를 적분하면 속도가 크게 틀어진다
    if (!cal || !cal.signsConfirmed || i < 0 || i >= m.n || !m.valid[i]) return { ax: 0, yawRate: 0, mode: 'gps_only' };
    const c = toCar(cal, [m.fx[i]!, m.fy[i]!, m.fz[i]!], [m.wx[i]!, m.wy[i]!, m.wz[i]!]);
    const useGyro = m.gyroValid[i] === 1;
    return { ax: c.ax, yawRate: c.yawRate, mode: useGyro ? 'imu' : 'imu_no_gyro' };
  }

  /** GPS 수신 시각과 격자 시각의 차이만큼 현재 속도로 옮겨서 반영한다 */
  private applyGps(o: GpsObs, tk: number): void {
    const lead = (tk - o.t) / 1000;
    const psi = this.ekf.x[2]!;
    const v = this.ekf.x[3]!;
    // 오래 끊겼다 돌아온 첫 점은 이상치 검사 없이 받아들인다 (예측이 멀리 가 있어도 끌어온다)
    const afterGap = o.t - this.prevGpsT > cfg.noGateAfterGapS * 1000;
    this.prevGpsT = o.t;
    this.ekf.updatePosition(
      o.x + v * Math.cos(psi) * lead,
      o.y + v * Math.sin(psi) * lead,
      Math.max(cfg.minPosSigmaM, o.hAcc * cfg.hAccToSigma),
      !afterGap,
    );
    if (o.speed !== null && !o.speedDerived) this.ekf.updateSpeed(o.speed, cfg.speedSigmaMps);
    if (o.psi !== null && (o.speed ?? this.ekf.x[3]!) >= cfg.headingMinSpeedMps) {
      this.ekf.updateHeading(o.psi, (cfg.headingSigmaDeg * Math.PI) / 180);
    }
  }

  private point(t: number): FusedPoint {
    const x = this.ekf.x;
    return { t, x: x[0]!, y: x[1]!, psi: x[2]!, v: x[3]!, sigmaPos: this.ekf.positionSigma(), mode: this.lastMode };
  }
}
