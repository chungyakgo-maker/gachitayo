// 거치 보정 (사양서 7.2): 기기 축 → 차 기준 축(앞 x, 왼쪽 y, 위 z).
//
// 1. 위 방향: 정차(GPS 속도 < 0.5 m/s, 가속도 변동 작음) 3초 동안의 중력 벡터 평균.
//    GPS 속도가 없는 기기는 GPS 위치가 4초 동안 한곳에 모여 있는지로 정차를 판단한다.
//    앞 방향을 찾기 전에 다른 정차 창의 중력 방향이 10° 넘게 다르면(손에 들고 있다가 거치) 새 값으로 바꾼다.
// 2. 앞 방향: 직진 중 GPS 속도 변화율 ≥ 1.5 m/s²인 구간의 수평 가속 방향.
//    구간마다 (속도 변화율 × 수평 가속도)를 더해 최소제곱 방향을 얻는다. 부호는 속도 변화율이 정한다.
//    직진 판단은 자이로가 있으면 자이로로, 없으면 GPS 진행 방향 변화율로 한다.
// 3. 왼쪽 = 위 × 앞
// 4. 재보정: 가속도 평균이 "GPS 속도 변화율과 v×요레이트로 예상한 가속도"와 10° 넘게
//    2초 이상 어긋나면 재보정 이벤트를 남기고 1~3을 다시 한다. 요레이트는 부호를 확인한 자이로 값을 쓴다
//    (GPS 진행 방향은 1초쯤 늦어서 헤어핀에서 거치 변화로 착각한다). 자이로가 없거나 부호 확인 전에는
//    좌우 성분을 빼고 앞·위 평면에서만 비교한다.
// 5. 확인: 보정 뒤 (a) 앞뒤 가속도가 GPS 속도 변화와 같은 방향인지(아니면 앞 방향을 뒤집는다),
//    (b) 코너에서 자이로 요레이트와 좌우 가속도가 GPS 진행 방향 변화율과 같은 부호인지 확인한다.
//    플랫폼마다 가속도·자이로 부호가 다를 수 있기 때문이다 (사양서 6.3). 확인 전에는 융합에 모션을 쓰지 않는다.
// 6. 주행 후: 재보정 지점과 정차 중력 방향이 바뀐 지점으로 나눈 구간마다 전체 데이터로 다시 계산한다.
//
// 정차 구간의 평균 회전 속도는 자이로 바이어스로 쓴다.
import { config } from '../engine/config';
import { gpsYawRateAt, type GpsObs } from '../engine/fusion/gpsObs';
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
  /** 요레이트에 곱할 부호 (플랫폼 부호 보정) */
  yawSign: 1 | -1;
  /** 좌우 가속도에 곱할 부호 (플랫폼 부호 보정) */
  latSign: 1 | -1;
  /** 코너에서 부호를 확인했는지. 확인 전에는 요레이트·좌우 가속도를 믿지 않는다 */
  signsConfirmed: boolean;
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
    ay: cal.latSign * dot(cal.left, f),
    az: dot(cal.up, f) - cal.gravity,
    yawRate: cal.yawSign * dot(cal.up, sub(w, cal.gyroBias)),
  };
}

// ── 구간 평균 (누적합) ─────────────────────────────────

class MotionWindows {
  private done = 0;
  private readonly s: Float64Array[];
  private readonly sff: Float64Array;
  private readonly sv: Float64Array;
  private readonly sgv: Float64Array;

  constructor(private readonly m: Motion50) {
    this.s = Array.from({ length: 6 }, () => new Float64Array(m.n + 1));
    this.sff = new Float64Array(m.n + 1);
    this.sv = new Float64Array(m.n + 1);
    this.sgv = new Float64Array(m.n + 1);
  }

  extendTo(i: number): void {
    const m = this.m;
    const cols = [m.fx, m.fy, m.fz, m.wx, m.wy, m.wz];
    for (let k = this.done; k <= Math.min(i, m.n - 1); k++) {
      const v = m.valid[k]!;
      const gv = v && m.gyroValid[k] ? 1 : 0;
      for (let c = 0; c < 3; c++) this.s[c]![k + 1] = this.s[c]![k]! + (v ? cols[c]![k]! : 0);
      for (let c = 3; c < 6; c++) this.s[c]![k + 1] = this.s[c]![k]! + (gv ? cols[c]![k]! : 0);
      this.sff[k + 1] = this.sff[k]! + (v ? m.fx[k]! ** 2 + m.fy[k]! ** 2 + m.fz[k]! ** 2 : 0);
      this.sv[k + 1] = this.sv[k]! + v;
      this.sgv[k + 1] = this.sgv[k]! + gv;
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

  gyroAllValid([ia, ib]: [number, number]): boolean {
    return this.sgv[ib + 1]! - this.sgv[ia]! === ib - ia + 1;
  }

  private mean(c0: number, [ia, ib]: [number, number]): Vec3 {
    const k = ib - ia + 1;
    return [0, 1, 2].map((d) => (this.s[c0 + d]![ib + 1]! - this.s[c0 + d]![ia]!) / k) as Vec3;
  }

  meanF(r: [number, number]): Vec3 {
    return this.mean(0, r);
  }

  /** 자이로가 유효한 구간에서만 쓴다 */
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

/** 위치를 시간에 대해 직선 맞춤한 속도 m/s (잡음이 있어도 일정한 이동은 드러난다) */
function fittedSpeed(fixes: GpsObs[]): number {
  const n = fixes.length;
  const tm = fixes.reduce((a, g) => a + g.t, 0) / n / 1000;
  const xm = fixes.reduce((a, g) => a + g.x, 0) / n;
  const ym = fixes.reduce((a, g) => a + g.y, 0) / n;
  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (const g of fixes) {
    const dt = g.t / 1000 - tm;
    stt += dt * dt;
    stx += dt * (g.x - xm);
    sty += dt * (g.y - ym);
  }
  return stt > 0 ? Math.hypot(stx / stt, sty / stt) : 0;
}

interface StationaryStats {
  meanF: Vec3;
  /** 자이로가 유효하지 않으면 null */
  meanW: Vec3 | null;
}

/** 시각 tEnd에서 끝나는 3초 창이 정차 조건을 만족하면 평균을 돌려준다 */
function stationaryAt(w: MotionWindows, gps: GpsObs[], tEnd: number): StationaryStats | null {
  const ta = tEnd - cfg.stationaryWindowS * 1000;
  const r = w.range(ta, tEnd);
  if (!r || !w.allValid(r)) return null;
  if (w.vecStd(r) >= cfg.stationaryAccStdMax) return null;
  const fixes = fixesIn(gps, ta, tEnd);
  if (fixes.length < cfg.stationaryMinGpsFixes) return null;
  if (fixes.some((g) => g.speedDerived)) {
    // GPS 속도가 없는 기기: 속도 대신 위치가 한곳에 모여 있는지 본다
    const span = fixesIn(gps, tEnd - cfg.stationaryDerivedWindowS * 1000, tEnd);
    if (span.length < 3 || fittedSpeed(span) >= cfg.stationaryDerivedMaxSpeedMps) return null;
  } else if (fixes.some((g) => g.speed === null || g.speed >= cfg.stationarySpeedMps)) {
    return null;
  }
  return { meanF: w.meanF(r), meanW: w.gyroAllValid(r) ? w.meanW(r) : null };
}

/** GPS 점 k 앞뒤로 속도 변화율을 구하는 간격 (속도 없는 기기는 잡음이 커서 2점씩) */
function speedSpan(gps: GpsObs[], k: number): number {
  for (let d = -2; d <= 2; d++) if (gps[k + d]?.speedDerived) return 2;
  return 1;
}

/** GPS 점 k를 가운데로 한 구간의 앞 방향 기여 (A, 수평 가속도). 조건을 만족하지 않으면 null */
function forwardSample(
  w: MotionWindows,
  gps: GpsObs[],
  k: number,
  up: Vec3,
  gyroBias: Vec3 | null,
): { A: number; h: Vec3 } | null {
  const hspan = speedSpan(gps, k);
  const a = gps[k - hspan];
  const c = gps[k];
  const b = gps[k + hspan];
  if (!a || !b || !c || a.speed === null || b.speed === null || c.speed === null) return null;
  const span = b.t - a.t;
  if (span <= 0 || span > cfg.forwardMaxGpsSpanMs * hspan || c.speed < cfg.forwardMinSpeedMps) return null;
  const A = (b.speed - a.speed) / (span / 1000);
  if (Math.abs(A) < cfg.forwardMinAccelMps2) return null;
  const r = w.range(a.t, b.t);
  if (!r || !w.allValid(r)) return null;
  // 직진 판단: 자이로가 있으면 자이로(부호와 무관), 없으면 GPS 진행 방향 변화율
  let yaw: number | null;
  if (gyroBias && w.gyroAllValid(r)) yaw = dot(sub(w.meanW(r), gyroBias), up);
  else yaw = gpsYawRateAt(gps, k, cfg.forwardMaxGpsSpanMs);
  if (yaw === null || Math.abs(yaw) >= cfg.forwardMaxYawRate) return null;
  const f = w.meanF(r);
  return { A, h: sub(f, scale(up, dot(f, up))) };
}

function buildCalibration(
  up: Vec3,
  gravity: number,
  gyroBias: Vec3,
  fwdSum: Vec3,
  t: number,
  signs: Pick<MountCalibration, 'yawSign' | 'latSign' | 'signsConfirmed'>,
): MountCalibration {
  const f0 = normalize(fwdSum);
  const fwd = normalize(sub(f0, scale(up, dot(f0, up))));
  const left = cross(up, fwd);
  return { R: fromRows(fwd, left, up), fwd, left, up, gravity, gyroBias, tCalibrated: t, ...signs };
}

// ── 축 부호 확인 ───────────────────────────────────────

/** 코너에서 자이로 요레이트·좌우 가속도를 GPS 진행 방향 변화율과 비교한 누적 통계 */
class SignStats {
  private fa = 0;
  private ff = 0;
  private aa = 0;
  private fwdN = 0;
  private yg = 0;
  private yy = 0;
  private gg = 0;
  private lv = 0;
  private ll = 0;
  private vv = 0;
  private turns = 0;
  private gyroTurns = 0;

  /** 앞 방향 확인: 보정한 앞 방향 성분과 GPS 속도 변화율 */
  addFwd(fwd: number, A: number): void {
    this.fa += fwd * A;
    this.ff += fwd * fwd;
    this.aa += A * A;
    this.fwdN += 1;
  }

  add(gpsYaw: number, gyroYaw: number | null, lat: number, v: number): void {
    const vg = v * gpsYaw;
    this.lv += lat * vg;
    this.ll += lat * lat;
    this.vv += vg * vg;
    this.turns += 1;
    if (gyroYaw !== null) {
      this.yg += gyroYaw * gpsYaw;
      this.yy += gyroYaw * gyroYaw;
      this.gg += gpsYaw * gpsYaw;
      this.gyroTurns += 1;
    }
  }

  /**
   * fwdSign: 앞 방향을 뒤집어야 하면 −1 / fwdOk: 앞 방향 확인 완료
   * yawSign, latSign: 플랫폼 부호 보정 (latSign은 앞 방향을 바로잡은 축 기준) / platformOk: 부호 확인 완료
   */
  result(): { fwdSign: 1 | -1; fwdOk: boolean; yawSign: 1 | -1; latSign: 1 | -1; platformOk: boolean } {
    const fwdAgree = this.fa / Math.sqrt(this.ff * this.aa || 1);
    const latAgree = this.lv / Math.sqrt(this.ll * this.vv || 1);
    const yawAgree = this.yg / Math.sqrt(this.yy * this.gg || 1);
    const fwdSign: 1 | -1 = fwdAgree < 0 ? -1 : 1;
    const gyroUsed = this.gyroTurns >= cfg.axisSignMinTurns;
    return {
      fwdSign,
      fwdOk: this.fwdN >= cfg.fwdCheckMinSamples && Math.abs(fwdAgree) >= cfg.axisSignMinAgreement,
      yawSign: gyroUsed && yawAgree < 0 ? -1 : 1,
      // 좌우 통계는 바로잡기 전 왼쪽 축으로 쟀으므로 앞 방향을 뒤집으면 같이 뒤집는다
      latSign: ((latAgree < 0 ? -1 : 1) * fwdSign) as 1 | -1,
      platformOk:
        this.turns >= cfg.axisSignMinTurns &&
        Math.abs(latAgree) >= cfg.axisSignMinAgreement &&
        (!gyroUsed || Math.abs(yawAgree) >= cfg.axisSignMinAgreement),
    };
  }
}

/** GPS 점 k의 확인 표본(앞뒤 가속, 코너)을 통계에 넣는다 */
function addSignSample(stats: SignStats, w: MotionWindows, gps: GpsObs[], k: number, cal: MountCalibration): void {
  // (a) 앞 방향: 보정한 앞 방향 가속도 성분이 GPS 속도 변화율과 같은 방향인가
  const hs = speedSpan(gps, k);
  const fa = gps[k - hs];
  const fb = gps[k + hs];
  if (fa && fb && fa.speed !== null && fb.speed !== null && fb.t - fa.t <= cfg.forwardMaxGpsSpanMs * hs) {
    const A = (fb.speed - fa.speed) / ((fb.t - fa.t) / 1000);
    const fr = w.range(fa.t, fb.t);
    if (Math.abs(A) >= cfg.fwdCheckMinAccelMps2 && fr && w.allValid(fr)) stats.addFwd(dot(w.meanF(fr), cal.fwd), A);
  }
  // (b) 코너: 요레이트·좌우 가속도 부호
  const a = gps[k - 1];
  const c = gps[k];
  const b = gps[k + 1];
  if (!a || !b || !c || c.speed === null || c.speed < cfg.axisSignMinSpeedMps) return;
  const gpsYaw = gpsYawRateAt(gps, k, cfg.forwardMaxGpsSpanMs);
  if (gpsYaw === null || Math.abs(gpsYaw) < cfg.axisSignMinYawRate) return;
  const r = w.range(a.t, b.t);
  if (!r || !w.allValid(r)) return;
  const gyroYaw = w.gyroAllValid(r) ? dot(sub(w.meanW(r), cal.gyroBias), cal.up) : null;
  stats.add(gpsYaw, gyroYaw, dot(w.meanF(r), cal.left), c.speed);
}

const UNCONFIRMED = { yawSign: 1, latSign: 1, signsConfirmed: false } as const;

/** 확인 결과를 보정에 반영한다 (앞 방향이 거꾸로 잡혔으면 앞·왼쪽을 뒤집는다) */
function applyChecks(
  cal: MountCalibration,
  fwdSign: 1 | -1,
  yawSign: 1 | -1,
  latSign: 1 | -1,
  confirmed: boolean,
): MountCalibration {
  const fwd = scale(cal.fwd, fwdSign);
  const left = scale(cal.left, fwdSign);
  return { ...cal, fwd, left, R: fromRows(fwd, left, cal.up), yawSign, latSign, signsConfirmed: confirmed };
}

// ── 실시간 보정기 ──────────────────────────────────────

export class MountCalibrator {
  state: CalState = 'need_stationary';
  current: MountCalibration | null = null;
  readonly events: CalEvent[] = [];

  private readonly w: MotionWindows;
  private readonly gps: GpsObs[] = [];
  private nextK = 1;
  private up: Vec3 = [0, 0, 1];
  private gravity = 0;
  private gyroBias: Vec3 | null = null;
  private fwdSum: Vec3 = [0, 0, 0];
  private fwdCount = 0;
  private mismatchSince: number | null = null;
  private checkA = 0;
  private checkV = 0;
  private lastGpsT = -Infinity;
  private signStats = new SignStats();

  constructor(private readonly m: Motion50) {
    this.w = new MotionWindows(m);
  }

  pushGps(obs: GpsObs): void {
    const prev = this.gps[this.gps.length - 1];
    this.gps.push(obs);
    this.lastGpsT = obs.t;
    if (prev && obs.speed !== null && prev.speed !== null && obs.t - prev.t <= cfg.recalMaxGpsStepMs) {
      this.checkA = (obs.speed - prev.speed) / ((obs.t - prev.t) / 1000);
      this.checkV = obs.speed;
    }
  }

  /** Motion50의 인덱스 i까지 처리한다 (순서대로 부른다) */
  pushMotion(i: number): void {
    this.w.extendTo(i);
    const t = this.m.t0 + i * this.m.dt;
    if (this.state !== 'calibrated') {
      const st = stationaryAt(this.w, this.gps, t);
      if (st) this.onStationary(st);
    }
    // GPS 점 k: 그 다음 점까지 모션이 들어오면 평가한다 (앞 방향, 축 부호)
    while (this.nextK + 2 < this.gps.length && this.gps[this.nextK + 2]!.t <= t) {
      const k = this.nextK++;
      if (this.state === 'need_forward') this.onForwardCandidate(k, t);
      else if (this.state === 'calibrated' && !this.current!.signsConfirmed) this.onSignCandidate(k);
    }
    if (this.state === 'calibrated' && i % cfg.recalCheckEvery === 0) this.checkMount(t);
  }

  private onStationary(st: StationaryStats): void {
    const up = normalize(st.meanF);
    // 처음 정차이거나, 앞 방향을 찾기 전에 중력 방향이 크게 바뀌었으면(손에 들고 있다가 거치) 새로 시작한다
    if (this.state === 'need_stationary' || angleBetween(up, this.up) * DEG > cfg.recalAngleDeg) {
      this.up = up;
      this.gravity = norm(st.meanF);
      this.gyroBias = st.meanW;
      this.fwdSum = [0, 0, 0];
      this.fwdCount = 0;
      this.state = 'need_forward';
    }
  }

  private onForwardCandidate(k: number, t: number): void {
    const smp = forwardSample(this.w, this.gps, k, this.up, this.gyroBias);
    if (!smp) return;
    this.fwdSum = add(this.fwdSum, scale(smp.h, smp.A));
    this.fwdCount += 1;
    if (this.fwdCount >= cfg.forwardMinIntervals) {
      this.current = buildCalibration(this.up, this.gravity, this.gyroBias ?? [0, 0, 0], this.fwdSum, t, UNCONFIRMED);
      this.signStats = new SignStats();
      this.state = 'calibrated';
      this.mismatchSince = null;
      this.events.push({ t, type: 'calibration' });
    }
  }

  private onSignCandidate(k: number): void {
    addSignSample(this.signStats, this.w, this.gps, k, this.current!);
    const r = this.signStats.result();
    if (r.fwdOk && r.platformOk) this.current = applyChecks(this.current!, r.fwdSign, r.yawSign, r.latSign, true);
  }

  private checkMount(t: number): void {
    const cal = this.current!;
    const r = this.w.range(t - cfg.recalAvgWindowS * 1000, t);
    // GPS 속도가 없는 기기는 위치로 계산한 속도가 너무 흔들려서 예상 가속도를 믿을 수 없다.
    // 이런 기기는 주행 중 거치 변화를 판단하지 않는다 (주행 후 처리에서 정차 중력 방향으로 나눈다).
    const lowSpeedQuality = this.gps[this.gps.length - 1]?.speedDerived === true;
    if (lowSpeedQuality || t - this.lastGpsT > cfg.recalMaxGpsAgeMs || !r || !this.w.allValid(r)) {
      this.mismatchSince = null;
      return;
    }
    let f = this.w.meanF(r);
    let expected = add(scale(cal.fwd, this.checkA), scale(cal.up, cal.gravity));
    if (cal.signsConfirmed && this.w.gyroAllValid(r)) {
      // 좌우 가속도 예상: v × 요레이트 (부호를 확인한 자이로 값). 기기 축 원본 기준이라 latSign을 다시 곱한다
      const yaw = cal.yawSign * dot(sub(this.w.meanW(r), cal.gyroBias), cal.up);
      expected = add(expected, scale(cal.left, cal.latSign * this.checkV * yaw));
    } else {
      // 부호를 확인하기 전에는 좌우 성분을 빼고 앞·위 평면에서만 비교한다
      f = sub(f, scale(cal.left, dot(f, cal.left)));
    }
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
 * 재보정 지점과 정차 중력 방향이 바뀐 지점으로 나누고, 구간마다 모든 정차 창·가속 구간·코너를 쓴다.
 */
export function calibrateSession(
  m: Motion50,
  gps: GpsObs[],
): { segments: CalSegment[]; events: CalEvent[] } {
  const events = runStreaming(m, gps).events;
  const tEnd = m.t0 + Math.max(0, m.n - 1) * m.dt;
  const w = new MotionWindows(m);
  w.extendTo(m.n - 1);

  // 모든 정차 창
  const windows: Array<{ t: number; st: StationaryStats }> = [];
  for (let t = m.t0 + cfg.stationaryWindowS * 1000; t <= tEnd; t += cfg.offlineStationaryStep * m.dt) {
    const st = stationaryAt(w, gps, t);
    if (st) windows.push({ t, st });
  }

  // 나누는 지점: 재보정 이벤트 + 정차 중력 방향이 10° 넘게 바뀐 곳
  const cuts = events.filter((e) => e.type === 'recalibration').map((e) => e.t - cfg.recalHoldS * 1000);
  let clusterUp: Vec3 | null = null;
  for (const { t, st } of windows) {
    const up = normalize(st.meanF);
    if (clusterUp && angleBetween(up, clusterUp) * DEG > cfg.recalAngleDeg) {
      cuts.push(t - cfg.stationaryWindowS * 1000);
      clusterUp = up;
    } else {
      clusterUp = clusterUp ? normalize(add(clusterUp, up)) : up;
    }
  }
  const bounds = [m.t0, ...cuts.filter((c) => c > m.t0 && c < tEnd).sort((a, b) => a - b), tEnd];

  const segments: CalSegment[] = [];
  const checks: Array<ReturnType<SignStats['result']> | null> = [];
  for (let s = 0; s < bounds.length - 1; s++) {
    const ta = bounds[s]!;
    const tb = bounds[s + 1]!;
    const inSeg = windows.filter(({ t }) => t - cfg.stationaryWindowS * 1000 >= ta && t <= tb);
    if (inSeg.length === 0) {
      segments.push({ tStart: ta, tEnd: tb, cal: null });
      checks.push(null);
      continue;
    }
    const meanF = scale(inSeg.reduce<Vec3>((a, x) => add(a, x.st.meanF), [0, 0, 0]), 1 / inSeg.length);
    const gyroWins = inSeg.filter((x) => x.st.meanW !== null);
    const gyroBias = gyroWins.length
      ? scale(gyroWins.reduce<Vec3>((a, x) => add(a, x.st.meanW!), [0, 0, 0]), 1 / gyroWins.length)
      : null;
    const up = normalize(meanF);
    let fwdSum: Vec3 = [0, 0, 0];
    let fwdCount = 0;
    for (let k = 1; k < gps.length - 1; k++) {
      if (gps[k - 1]!.t < ta || gps[k + 1]!.t > tb) continue;
      const smp = forwardSample(w, gps, k, up, gyroBias);
      if (!smp) continue;
      fwdSum = add(fwdSum, scale(smp.h, smp.A));
      fwdCount += 1;
    }
    if (fwdCount < cfg.forwardMinIntervals) {
      segments.push({ tStart: ta, tEnd: tb, cal: null });
      checks.push(null);
      continue;
    }
    const cal = buildCalibration(up, norm(meanF), gyroBias ?? [0, 0, 0], fwdSum, ta, UNCONFIRMED);
    const stats = new SignStats();
    for (let k = 2; k < gps.length - 2; k++) {
      if (gps[k - 2]!.t >= ta && gps[k + 2]!.t <= tb) addSignSample(stats, w, gps, k, cal);
    }
    checks.push(stats.result());
    segments.push({ tStart: ta, tEnd: tb, cal });
  }

  // 플랫폼 부호는 구간마다 같으므로, 확인하지 못한 구간은 확인한 구간의 부호를 쓴다
  const platform = checks.find((c) => c?.platformOk);
  segments.forEach((s, i) => {
    const r = checks[i];
    if (!s.cal || !r) return;
    const p = r.platformOk ? r : platform;
    // p.latSign은 앞 방향을 바로잡은 축 기준이라 구간마다 그대로 쓴다
    s.cal = applyChecks(s.cal, r.fwdSign, p ? p.yawSign : 1, p ? p.latSign : 1, r.fwdOk && !!p);
  });
  return { segments, events };
}

// ── 플랫폼 축 부호 ─────────────────────────────────────

/**
 * 보정 결과의 요레이트·좌우 가속도 부호 보정을 플랫폼 원본 부호로 바꿔 알려준다 (플랫폼 기본값 표를 정하는 데 쓴다).
 * 가속도가 뒤집힌 기기는 위·앞 방향이 거꾸로 잡혀 요레이트와 좌우 가속도가 함께 뒤집히고,
 * 자이로만 뒤집힌 기기는 요레이트만, 둘 다 뒤집힌 기기는 좌우 가속도만 뒤집힌다.
 */
export function detectAxisSigns(
  m: Motion50,
  gps: GpsObs[],
  cal: MountCalibration,
): { accel: 1 | -1; gyro: 1 | -1; confidence: 'high' | 'low' } {
  const w = new MotionWindows(m);
  w.extendTo(m.n - 1);
  const stats = new SignStats();
  for (let k = 1; k < gps.length - 1; k++) addSignSample(stats, w, gps, k, { ...cal, ...UNCONFIRMED });
  const r = stats.result();
  return { ...platformSigns(r.yawSign, r.latSign), confidence: r.fwdOk && r.platformOk ? 'high' : 'low' };
}

export function platformSigns(yawSign: 1 | -1, latSign: 1 | -1): { accel: 1 | -1; gyro: 1 | -1 } {
  if (yawSign === 1 && latSign === 1) return { accel: 1, gyro: 1 };
  if (yawSign === -1 && latSign === -1) return { accel: -1, gyro: 1 };
  if (yawSign === -1) return { accel: 1, gyro: -1 };
  return { accel: -1, gyro: -1 };
}
