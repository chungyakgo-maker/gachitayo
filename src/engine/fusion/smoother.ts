// RTS 스무더 (사양서 7.3 주행 후): 앞에서 뒤로 필터한 기록을 뒤에서 앞으로 보정한다.
import { wrapAngle } from '../linalg';
import type { FusionHistory } from './forward';

export interface SmoothedTrack {
  /** 첫 점 시각 (세션 시계 ms) */
  t0: number;
  /** 간격 ms */
  dt: number;
  n: number;
  x: Float64Array;
  y: Float64Array;
  /** 동쪽 기준 반시계 rad, [-π, π) */
  psi: Float64Array;
  v: Float64Array;
  /** 0: imu, 1: imu_no_gyro, 2: gps_only */
  mode: Uint8Array;
}

const N = 5;

/** 5×5 역행렬 (가우스-조르당). 특이하면 null */
function invert(a: Float64Array): Float64Array | null {
  const m = new Float64Array(N * 2 * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) m[i * 2 * N + j] = a[i * N + j]!;
    m[i * 2 * N + N + i] = 1;
  }
  for (let c = 0; c < N; c++) {
    let p = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(m[r * 2 * N + c]!) > Math.abs(m[p * 2 * N + c]!)) p = r;
    const pv = m[p * 2 * N + c]!;
    if (Math.abs(pv) < 1e-300) return null;
    if (p !== c)
      for (let j = 0; j < 2 * N; j++) {
        const t = m[c * 2 * N + j]!;
        m[c * 2 * N + j] = m[p * 2 * N + j]!;
        m[p * 2 * N + j] = t;
      }
    for (let j = 0; j < 2 * N; j++) m[c * 2 * N + j] /= pv;
    for (let r = 0; r < N; r++) {
      if (r === c) continue;
      const f = m[r * 2 * N + c]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * N; j++) m[r * 2 * N + j] -= f * m[c * 2 * N + j]!;
    }
  }
  const out = new Float64Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) out[i * N + j] = m[i * 2 * N + N + j]!;
  return out;
}

/** 필터 결과만 꺼낸다 (실시간 결과와 같음) */
export function filteredTrack(h: FusionHistory): SmoothedTrack {
  const out = emptyTrack(h);
  for (let k = 0; k < h.n; k++) setRow(out, k, h.xFilt, k * N);
  return out;
}

export function rtsSmooth(h: FusionHistory): SmoothedTrack {
  const out = emptyTrack(h);
  if (h.n === 0) return out;
  const xs = new Float64Array(h.n * N);
  xs.set(h.xFilt.subarray((h.n - 1) * N, h.n * N), (h.n - 1) * N);
  const C = new Float64Array(N * N);
  const dx = new Float64Array(N);
  for (let k = h.n - 2; k >= 0; k--) {
    const Pf = h.PFilt.subarray(k * N * N, (k + 1) * N * N);
    const F = h.F.subarray((k + 1) * N * N, (k + 2) * N * N);
    const PpInv = invert(h.PPred.subarray((k + 1) * N * N, (k + 2) * N * N));
    for (let i = 0; i < N; i++) dx[i] = xs[(k + 1) * N + i]! - h.xPred[(k + 1) * N + i]!;
    dx[2] = wrapAngle(dx[2]!);
    if (PpInv) {
      // C = Pf · Fᵀ · Pp⁻¹
      const PfFt = new Float64Array(N * N);
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          let s = 0;
          for (let q = 0; q < N; q++) s += Pf[i * N + q]! * F[j * N + q]!;
          PfFt[i * N + j] = s;
        }
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          let s = 0;
          for (let q = 0; q < N; q++) s += PfFt[i * N + q]! * PpInv[q * N + j]!;
          C[i * N + j] = s;
        }
    } else {
      C.fill(0);
    }
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = 0; j < N; j++) s += C[i * N + j]! * dx[j]!;
      xs[k * N + i] = h.xFilt[k * N + i]! + s;
    }
    xs[k * N + 2] = wrapAngle(xs[k * N + 2]!);
  }
  for (let k = 0; k < h.n; k++) setRow(out, k, xs, k * N);
  return out;
}

function emptyTrack(h: FusionHistory): SmoothedTrack {
  return {
    t0: h.t0,
    dt: h.dt,
    n: h.n,
    x: new Float64Array(h.n),
    y: new Float64Array(h.n),
    psi: new Float64Array(h.n),
    v: new Float64Array(h.n),
    mode: h.mode.slice(),
  };
}

function setRow(t: SmoothedTrack, k: number, src: Float64Array, o: number): void {
  t.x[k] = src[o]!;
  t.y[k] = src[o + 1]!;
  t.psi[k] = wrapAngle(src[o + 2]!);
  t.v[k] = src[o + 3]!;
}

/**
 * 모션 없이(GPS만) 오래 끊긴 구간은 필터·스무더의 선형 근사가 맞지 않아(방향 불확실성이 몇 rad까지 커짐)
 * 경로가 크게 벗어난다. 이런 구간은 끊기기 전·후의 위치와 속도로 매끄러운 곡선(3차 에르미트)을 그려 잇는다.
 */
export function bridgeGpsOnlyGaps(track: SmoothedTrack, gaps: Array<[number, number]>): SmoothedTrack {
  const GPS_ONLY = 2;
  for (const [ta, tb] of gaps) {
    const ka = Math.ceil((ta - track.t0) / track.dt);
    const kb = Math.floor((tb - track.t0) / track.dt);
    if (ka < 0 || kb >= track.n || kb - ka < 2) continue;
    let allGpsOnly = true;
    for (let k = ka; k <= kb; k++) if (track.mode[k] !== GPS_ONLY) allGpsOnly = false;
    if (!allGpsOnly) continue;
    const T = ((kb - ka) * track.dt) / 1000;
    const p0x = track.x[ka]!;
    const p0y = track.y[ka]!;
    const p1x = track.x[kb]!;
    const p1y = track.y[kb]!;
    const v0x = track.v[ka]! * Math.cos(track.psi[ka]!) * T;
    const v0y = track.v[ka]! * Math.sin(track.psi[ka]!) * T;
    const v1x = track.v[kb]! * Math.cos(track.psi[kb]!) * T;
    const v1y = track.v[kb]! * Math.sin(track.psi[kb]!) * T;
    for (let k = ka + 1; k < kb; k++) {
      const u = (k - ka) / (kb - ka);
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      track.x[k] = h00 * p0x + h10 * v0x + h01 * p1x + h11 * v1x;
      track.y[k] = h00 * p0y + h10 * v0y + h01 * p1y + h11 * v1y;
      // 미분 (위치/u) → 속도 (÷T)
      const d00 = 6 * u2 - 6 * u;
      const d10 = 3 * u2 - 4 * u + 1;
      const d01 = -6 * u2 + 6 * u;
      const d11 = 3 * u2 - 2 * u;
      const dx = (d00 * p0x + d10 * v0x + d01 * p1x + d11 * v1x) / T;
      const dy = (d00 * p0y + d10 * v0y + d01 * p1y + d11 * v1y) / T;
      track.v[k] = Math.hypot(dx, dy);
      track.psi[k] = Math.atan2(dy, dx);
    }
  }
  return track;
}
