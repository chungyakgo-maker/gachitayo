// 비교용 축약 데이터 (사양서 6.8): 코스 거리 5 m 격자 위의 { t, v, alt }.
// 고스트 델타와 분석 그래프에 쓴다. 비교 랩을 받을 때 큰 원본 파일 없이 이것만 받으면 된다.
import { config } from '../config';

export interface LapTrace {
  stepM: number;
  /** 랩 시작부터 경과 초 (소수 3자리) */
  t: number[];
  /** m/s (소수 2자리) */
  v: number[];
  /** m (소수 1자리). 고도를 모르면 null */
  alt: Array<number | null>;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * 랩 프레임(시각 ms, 코스 거리 s, 속도, 고도)으로 trace를 만든다.
 * 각 격자는 s가 처음 그 값에 닿는 시각을 프레임 사이에서 보간한다. 닿지 못한 격자는 앞뒤 격자로 보간한다.
 */
export function buildTrace(lap: {
  t: ArrayLike<number>;
  s: ArrayLike<number>;
  v: ArrayLike<number>;
  alt: ArrayLike<number> | null;
  startT: number;
  lengthM: number;
}): LapTrace {
  const step = config.delta.stepM;
  const m = Math.floor(lap.lengthM / step + 1e-9) + 1;
  const T = new Array<number>(m).fill(Number.NaN);
  const V = new Array<number>(m).fill(Number.NaN);
  const A = new Array<number>(m).fill(Number.NaN);
  T[0] = 0;
  V[0] = lap.v[0] ?? 0;
  A[0] = lap.alt ? lap.alt[0]! : Number.NaN;
  let g = 1;
  for (let k = 1; k < lap.t.length && g < m; k++) {
    const a = lap.s[k - 1]!;
    const b = lap.s[k]!;
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a || b - a > 50) continue;
    while (g < m && g * step <= b) {
      const target = g * step;
      if (target > a) {
        const f = (target - a) / (b - a);
        T[g] = (lap.t[k - 1]! + f * (lap.t[k]! - lap.t[k - 1]!) - lap.startT) / 1000;
        V[g] = lap.v[k - 1]! + f * (lap.v[k]! - lap.v[k - 1]!);
        A[g] = lap.alt ? lap.alt[k - 1]! + f * (lap.alt[k]! - lap.alt[k - 1]!) : Number.NaN;
      }
      g++;
    }
  }
  fillGaps(T);
  fillGaps(V);
  if (lap.alt) fillGaps(A);
  return {
    stepM: step,
    t: T.map((x) => round(x, 3)),
    v: V.map((x) => round(x, 2)),
    alt: A.map((x) => (Number.isNaN(x) ? null : round(x, 1))),
  };
}

/** NaN 칸을 앞뒤 값으로 선형 보간 (끝은 가장 가까운 값) */
function fillGaps(a: number[]): void {
  let last = -1;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]!)) continue;
    if (last >= 0 && i - last > 1)
      for (let j = last + 1; j < i; j++) a[j] = a[last]! + ((a[i]! - a[last]!) * (j - last)) / (i - last);
    if (last < 0) for (let j = 0; j < i; j++) a[j] = a[i]!;
    last = i;
  }
  if (last >= 0) for (let j = last + 1; j < a.length; j++) a[j] = a[last]!;
}

/**
 * 비교 랩에서 코스 거리 s에 닿은 시각 t_ref(s) (초).
 * 마지막 격자 뒤는 그 격자에서 랩 끝(lapTimeMs, 코스 길이)까지 보간한다.
 */
export function refTimeAt(trace: LapTrace, s: number, lapTimeMs: number, lengthM?: number): number {
  const n = trace.t.length;
  const f = Math.max(0, s / trace.stepM);
  const i = Math.floor(f);
  if (i < n - 1) return trace.t[i]! + (trace.t[i + 1]! - trace.t[i]!) * (f - i);
  const lastS = (n - 1) * trace.stepM;
  const end = lengthM ?? Math.max(lastS + trace.stepM, s);
  if (end <= lastS) return trace.t[n - 1]!;
  return trace.t[n - 1]! + (lapTimeMs / 1000 - trace.t[n - 1]!) * Math.min(1, (s - lastS) / (end - lastS));
}

/**
 * refTimeAt의 역: 비교 랩이 랩 시작 뒤 elapsedS초에 있던 코스 거리 (고스트 위치).
 * 랩 시간이 지나면 코스 끝, 0 이하면 0.
 */
export function refDistanceAt(trace: LapTrace, elapsedS: number, lapTimeMs: number, lengthM: number): number {
  const n = trace.t.length;
  if (elapsedS <= 0 || n === 0) return 0;
  const tLast = trace.t[n - 1]!;
  if (elapsedS >= tLast) {
    const lastS = (n - 1) * trace.stepM;
    const tEnd = lapTimeMs / 1000;
    if (elapsedS >= tEnd || tEnd <= tLast) return lengthM;
    return lastS + ((lengthM - lastS) * (elapsedS - tLast)) / (tEnd - tLast);
  }
  // t는 커지는 순서: 이진 탐색
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trace.t[mid]! <= elapsedS) lo = mid;
    else hi = mid;
  }
  const ta = trace.t[lo]!;
  const tb = trace.t[hi]!;
  const f = tb > ta ? (elapsedS - ta) / (tb - ta) : 0;
  return Math.min(lengthM, (lo + f) * trace.stepM);
}
