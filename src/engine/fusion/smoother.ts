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
