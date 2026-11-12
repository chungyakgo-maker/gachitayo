// 거치 보정 (사양서 7.2): 기기 축 → 차 기준 축(앞 x, 왼쪽 y, 위 z).
//
// 1. 아래(위) 방향: 정차(GPS 속도 < 0.5 m/s, 가속도 변동 작음) 3초 동안의 중력 벡터 평균
// 2. 앞 방향: 직진 중(요레이트 작음) GPS 속도 변화율 ≥ 1.5 m/s²인 구간의 수평 가속 방향.
//    구간마다 (속도 변화율 × 수평 가속도)를 더해 최소제곱 방향을 얻는다. 부호는 속도 변화율이 정한다.
// 3. 왼쪽 = 위 × 앞
// 4. 재보정: 가속도 평균이 "GPS 속도 변화율과 v×요레이트로 예상한 가속도"와 10° 넘게 2초 이상 어긋나면
//    재보정 이벤트를 남기고 1~3을 다시 한다. (겉보기 중력이 기우는 긴 제동·긴 코너를 거치 변화로 착각하지 않기 위해)
// 6. 주행 후: 재보정 지점으로 나눈 구간마다 전체 데이터로 다시 계산한다.
//
// 정차 구간의 평균 회전 속도는 자이로 바이어스로 쓴다.
import { config } from '../engine/config';
import type { GpsObs } from '../engine/fusion/gpsObs';
import {
  add,
  angleBetween,
  cross,
  dot,
  fromRows,
  norm,
  normalize,
  scale,
  sub,
  wrapAngle,
  type Mat3,
  type Vec3,
} from '../engine/linalg';
import type { Motion50 } from './resample';

export interface MountCalibration {
  /** 행: 앞, 왼쪽, 위 (기기 축 좌표). 차 축 = R · 기기 축 */
  R: Mat3;
  fwd: Vec3;
  left: Vec3;
  up: Vec3;
  /** 정차 때 측정한 중력 크기 m/s² */
  gravity: number;
  /** 기기 축 자이로 바이어스 rad/s */
  gyroBias: Vec3;
  /** 이 보정이 정해진 시각 (세션 시계 ms) */
  tCalibrated: number;
}

export type CalState = 'need_stationary' | 'need_forward' | 'calibrated';

export interface CalEvent {
  t: number;
  type: 'calibration' | 'recalibration';
}

export interface CarMotion {
  /** 앞 + (중력 제외) */
  ax: number;
  /** 왼쪽 + */
  ay: number;
  /** 위 + (중력 제외) */
  az: number;
  /** 좌회전 + rad/s */
  yawRate: number;
}

const DEG = 180 / Math.PI;
const cfg = config.mount;

/** 기기 축 가속도·회전 속도 → 차 기준 축 */
export function toCar(cal: MountCalibration, f: Vec3, w: Vec3): CarMotion {
  return {
    ax: dot(cal.fwd, f),
    ay: dot(cal.left, f),
    az: dot(cal.up, f) - cal.gravity,
    yawRate: dot(cal.up, sub(w, cal.gyroBias)),
  };
}

// ── 구간 평균 (누적합) ─────────────────────────────────

class MotionWindows {
  private done = 0;
  private readonly s: Float64Array[];
  private readonly sff: Float64Array;
  private readonly sv: Float64Array;

  constructor(private readonly m: Motion50) {
    this.s = Array.from({ length: 6 }, () => new Float64Array(m.n + 1));
    this.sff = new Float64Array(m.n + 1);
    this.sv = new Float64Array(m.n + 1);
  }

  get processed(): number {
    return this.done;
  }

  extendTo(i: number): void {
    const m = this.m;
    const cols = [m.fx, m.fy, m.fz, m.wx, m.wy, m.wz];
    for (let k = this.done; k <= Math.min(i, m.n - 1); k++) {
      const v = m.valid[k]!;
      for (let c = 0; c < 6; c++) this.s[c]![k + 1] = this.s[c]![k]! + (v ? cols[c]![k]! : 0);
      this.sff[k + 1] = this.sff[k]! + (v ? m.fx[k]! ** 2 + m.fy[k]! ** 2 + m.fz[k]! ** 2 : 0);
      this.sv[k + 1] = this.sv[k]! + v;
      this.done = k + 1;
    }
  }

  /** 시각 범위 [ta, tb] (ms) → 처리된 인덱스 범위. 범위가 데이터 밖이거나 아직 처리되지 않았으면 null */
  range(ta: number, tb: number): [number, number] | null {
    const ia = Math.ceil((ta - this.m.t0) / this.m.dt);
    const ib = Math.floor((tb - this.m.t0) / this.m.dt);
    if (ia < 0 || ib < ia || ib >= this.done) return null;
    return [ia, ib];
  }

  allValid([ia, ib]: [number, number]): boolean {
    return this.sv[ib + 1]! - this.sv[ia]! === ib - ia + 1;
  }

  private mean(c0: number, [ia, ib]: [number, number]): Vec3 {
    const k = ib - ia + 1;
    return [0, 1, 2].map((d) => (this.s[c0 + d]![ib + 1]! - this.s[c0 + d]![ia]!) / k) as Vec3;
  }

  meanF(r: [number, number]): Vec3 {
    return this.mean(0, r);
  }

  meanW(r: [number, number]): Vec3 {
    return this.mean(3, r);
  }

  /** 가속도 벡터의 표준편차 */
  vecStd(r: [number, number]): number {
    const k = r[1] - r[0] + 1;
    const ef2 = (this.sff[r[1] + 1]! - this.sff[r[0]]!) / k;
    const mf = this.meanF(r);
    return Math.sqrt(Math.max(0, ef2 - dot(mf, mf)));
  }
}

/** 정렬된 GPS에서 t가 [ta, tb]인 점들 */
function fixesIn(gps: GpsObs[], ta: number, tb: number): GpsObs[] {
  let lo = 0;
  let hi = gps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (gps[mid]!.t < ta) lo = mid + 1;
    else hi = mid;
  }
  const out: GpsObs[] = [];
  for (let i = lo; i < gps.length && gps[i]!.t <= tb; i++) out.push(gps[i]!);
  return out;
}

interface StationaryStats {
  meanF: Vec3;
  meanW: Vec3;
}

/** 시각 tEnd에서 끝나는 3초 창이 정차 조건을 만족하면 평균을 돌려준다 */
function stationaryAt(w: MotionWindows, gps: GpsObs[], tEnd: number): StationaryStats | null {
  const ta = tEnd - cfg.stationaryWindowS * 1000;
  const r = w.range(ta, tEnd);
  if (!r || !w.allValid(r)) return null;
  const fixes = fixesIn(gps, ta, tEnd);
  if (fixes.length < cfg.stationaryMinGpsFixes) return null;
  if (fixes.some((g) => g.speed === null || g.speed >= cfg.stationarySpeedMps)) return null;
  if (w.vecStd(r) >= cfg.stationaryAccStdMax) return null;
  return { meanF: w.meanF(r), meanW: w.meanW(r) };
}

/** GPS 점 k를 가운데로 한 구간의 앞 방향 기여 (A, 수평 가속도). 조건을 만족하지 않으면 null */
function forwardSample(
  w: MotionWindows,
  gps: GpsObs[],
  k: number,
  up: Vec3,
  gyroBias: Vec3,
): { A: number; h: Vec3 } | null {
  const a = gps[k - 1];
  const c = gps[k];
  const b = gps[k + 1];
  if (!a || !b || !c || a.speed === null || b.speed === null || c.speed === null) return null;
  const span = b.t - a.t;
  if (span <= 0 || span > cfg.forwardMaxGpsSpanMs || c.speed < cfg.forwardMinSpeedMps) return null;
  const A = (b.speed - a.speed) / (span / 1000);
  if (Math.abs(A) < cfg.forwardMinAccelMps2) return null;
  const r = w.range(a.t, b.t);
  if (!r || !w.allValid(r)) return null;
  const yaw = dot(sub(w.meanW(r), gyroBias), up);
  if (Math.abs(yaw) >= cfg.forwardMaxYawRate) return null;
  const f = w.meanF(r);
  return { A, h: sub(f, scale(up, dot(f, up))) };
}

function buildCalibration(up: Vec3, gravity: number, gyroBias: Vec3, fwdSum: Vec3, t: number): MountCalibration {
  const f0 = normalize(fwdSum);
  const fwd = normalize(sub(f0, scale(up, dot(f0, up))));
  const left = cross(up, fwd);
  return { R: fromRows(fwd, left, up), fwd, left, up, gravity, gyroBias, tCalibrated: t };
}

// ── 실시간 보정기 ──────────────────────────────────────

export class MountCalibrator {
  state: CalState = 'need_stationary';
  current: MountCalibration | null = null;
  readonly events: CalEvent[] = [];

  private readonly w: MotionWindows;
  private readonly gps: GpsObs[] = [];
  private nextForwardK = 1;
  private up: Vec3 = [0, 0, 1];
  private gravity = 0;
  private gyroBias: Vec3 = [0, 0, 0];
  private fwdSum: Vec3 = [0, 0, 0];
  private fwdCount = 0;
  private mismatchSince: number | null = null;
  private checkA = 0;
  private checkV = 0;
  private lastGpsT = -Infinity;

  constructor(private readonly m: Motion50) {
    this.w = new MotionWindows(m);
  }

  pushGps(obs: GpsObs): void {
    const prev = this.gps[this.gps.length - 1];
    this.gps.push(obs);
    this.lastGpsT = obs.t;
    if (prev && obs.speed !== null && prev.speed !== null && obs.t - prev.t <= 2500) {
      this.checkA = (obs.speed - prev.speed) / ((obs.t - prev.t) / 1000);
      this.checkV = obs.speed;
    }
  }

  /** Motion50의 인덱스 i까지 처리한다 (순서대로 부른다) */
  pushMotion(i: number): void {
    this.w.extendTo(i);
    const t = this.m.t0 + i * this.m.dt;
    if (this.state === 'need_stationary') {
      const st = stationaryAt(this.w, this.gps, t);
      if (st) {
        this.up = normalize(st.meanF);
        this.gravity = norm(st.meanF);
        this.gyroBias = st.meanW;
        this.fwdSum = [0, 0, 0];
        this.fwdCount = 0;
        this.state = 'need_forward';
      }
    }
    // 앞 방향: 가운데 GPS 점의 다음 점까지 모션이 들어오면 평가한다
    while (this.nextForwardK + 1 < this.gps.length && this.gps[this.nextForwardK + 1]!.t <= t) {
      const k = this.nextForwardK++;
      if (this.state !== 'need_forward') continue;
      const smp = forwardSample(this.w, this.gps, k, this.up, this.gyroBias);
      if (!smp) continue;
      this.fwdSum = add(this.fwdSum, scale(smp.h, smp.A));
      this.fwdCount += 1;
      if (this.fwdCount >= cfg.forwardMinIntervals) {
        this.current = buildCalibration(this.up, this.gravity, this.gyroBias, this.fwdSum, t);
        this.state = 'calibrated';
        this.mismatchSince = null;
        this.events.push({ t, type: 'calibration' });
      }
    }
    if (this.state === 'calibrated' && i % 5 === 0) this.checkMount(t);
  }

  private checkMount(t: number): void {
    const cal = this.current!;
    if (t - this.lastGpsT > cfg.recalMaxGpsAgeMs) {
      this.mismatchSince = null;
      return;
    }
    const r = this.w.range(t - cfg.recalAvgWindowS * 1000, t);
    if (!r || !this.w.allValid(r)) return;
    const f = this.w.meanF(r);
    const yaw = dot(sub(this.w.meanW(r), cal.gyroBias), cal.up);
    const expected = add(
      add(scale(cal.fwd, this.checkA), scale(cal.left, this.checkV * yaw)),
      scale(cal.up, cal.gravity),
    );
    if (angleBetween(f, expected) * DEG <= cfg.recalAngleDeg) {
      this.mismatchSince = null;
      return;
    }
    this.mismatchSince ??= t;
    if (t - this.mismatchSince >= cfg.recalHoldS * 1000) {
      this.events.push({ t, type: 'recalibration' });
      this.state = 'need_stationary';
      this.current = null;
      this.mismatchSince = null;
    }
  }
}

// ── 주행 후 보정 ───────────────────────────────────────

export interface CalSegment {
  tStart: number;
  tEnd: number;
  /** 이 구간을 보정하지 못했으면 null (G값 없음, 융합은 GPS만) */
  cal: MountCalibration | null;
}

/** 시간 순서대로 모션과 GPS를 실시간 보정기에 넣는다 */
function runStreaming(m: Motion50, gps: GpsObs[]): MountCalibrator {
  const c = new MountCalibrator(m);
  let j = 0;
  for (let i = 0; i < m.n; i++) {
    const t = m.t0 + i * m.dt;
    while (j < gps.length && gps[j]!.t <= t) c.pushGps(gps[j++]!);
    c.pushMotion(i);
  }
  return c;
}

/**
 * 세션 전체로 거치 보정을 다시 계산한다 (사양서 7.2-6).
 * 실시간 보정기로 재보정 지점을 찾고, 그 지점으로 나눈 구간마다 모든 정차 창과 가속 구간을 쓴다.
 */
export function calibrateSession(
  m: Motion50,
  gps: GpsObs[],
): { segments: CalSegment[]; events: CalEvent[] } {
  const streaming = runStreaming(m, gps);
  const events = streaming.events;
  const tEnd = m.t0 + Math.max(0, m.n - 1) * m.dt;
  const cuts = events
    .filter((e) => e.type === 'recalibration')
    .map((e) => e.t - cfg.recalHoldS * 1000);
  const bounds = [m.t0, ...cuts, tEnd];

  const w = new MotionWindows(m);
  w.extendTo(m.n - 1);
  const step = 25; // 0.5초마다 정차 창 검사
  const segments: CalSegment[] = [];
  for (let s = 0; s < bounds.length - 1; s++) {
    const ta = bounds[s]!;
    const tb = bounds[s + 1]!;
    let sumF: Vec3 = [0, 0, 0];
    let sumW: Vec3 = [0, 0, 0];
    let cnt = 0;
    for (let t = ta + cfg.stationaryWindowS * 1000; t <= tb; t += step * m.dt) {
      const st = stationaryAt(w, gps, t);
      if (!st) continue;
      sumF = add(sumF, st.meanF);
      sumW = add(sumW, st.meanW);
      cnt += 1;
    }
    if (cnt === 0) {
      segments.push({ tStart: ta, tEnd: tb, cal: null });
      continue;
    }
    const meanF = scale(sumF, 1 / cnt);
    const up = normalize(meanF);
    const gravity = norm(meanF);
    const gyroBias = scale(sumW, 1 / cnt);
    let fwdSum: Vec3 = [0, 0, 0];
    let fwdCount = 0;
    for (let k = 1; k < gps.length - 1; k++) {
      if (gps[k - 1]!.t < ta || gps[k + 1]!.t > tb) continue;
      const smp = forwardSample(w, gps, k, up, gyroBias);
      if (!smp) continue;
      fwdSum = add(fwdSum, scale(smp.h, smp.A));
      fwdCount += 1;
    }
    segments.push({
      tStart: ta,
      tEnd: tb,
      cal: fwdCount >= cfg.forwardMinIntervals ? buildCalibration(up, gravity, gyroBias, fwdSum, ta) : null,
    });
  }
  return { segments, events };
}

// ── 플랫폼 축 부호 판별 ─────────────────────────────────

/**
 * 플랫폼마다 가속도·자이로 부호가 다를 수 있다 (사양서 6.3). 보정 결과로 두 가지를 확인한다.
 * (1) 자이로 요레이트 부호 = GPS 진행 방향 변화율 부호?  (2) 좌우 가속도 부호 = v × 요레이트 부호?
 * (1)(2) 모두 맞음 → 그대로 / (1)만 틀림 → 가속도 뒤집힘 / 둘 다 틀림 → 자이로 뒤집힘 / (2)만 틀림 → 둘 다 뒤집힘.
 * 돌려주는 값은 이미 곱한 부호에 추가로 곱할 보정값이다.
 */
export function detectAxisSigns(
  m: Motion50,
  gps: GpsObs[],
  cal: MountCalibration,
): { accel: 1 | -1; gyro: 1 | -1; confidence: 'high' | 'low' } {
  const w = new MotionWindows(m);
  w.extendTo(m.n - 1);
  let c1 = 0;
  let c2 = 0;
  let turns = 0;
  for (let k = 1; k < gps.length - 1; k++) {
    const a = gps[k - 1]!;
    const c = gps[k]!;
    const b = gps[k + 1]!;
    const span = (b.t - a.t) / 1000;
    if (span <= 0 || span > cfg.forwardMaxGpsSpanMs / 1000 || c.speed === null || c.speed < cfg.axisSignMinSpeedMps) continue;
    let gpsYaw: number;
    if (a.psi !== null && b.psi !== null) {
      gpsYaw = wrapAngle(b.psi - a.psi) / span;
    } else {
      const p1 = Math.atan2(c.y - a.y, c.x - a.x);
      const p2 = Math.atan2(b.y - c.y, b.x - c.x);
      gpsYaw = wrapAngle(p2 - p1) / (span / 2);
    }
    if (Math.abs(gpsYaw) < cfg.axisSignMinYawRate) continue;
    const r = w.range(a.t, b.t);
    if (!r || !w.allValid(r)) continue;
    const gyroYaw = dot(sub(w.meanW(r), cal.gyroBias), cal.up);
    const lat = dot(w.meanF(r), cal.left);
    c1 += gpsYaw * gyroYaw;
    c2 += lat * c.speed * gyroYaw;
    turns += 1;
  }
  if (turns < cfg.axisSignMinTurns) return { accel: 1, gyro: 1, confidence: 'low' };
  const ok1 = c1 > 0;
  const ok2 = c2 > 0;
  if (ok1 && ok2) return { accel: 1, gyro: 1, confidence: 'high' };
  if (!ok1 && ok2) return { accel: -1, gyro: 1, confidence: 'high' };
  if (!ok1 && !ok2) return { accel: 1, gyro: -1, confidence: 'high' };
  return { accel: -1, gyro: -1, confidence: 'high' };
}
