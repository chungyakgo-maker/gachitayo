// 랩 (사양서 7.8), 구간 기록 (7.9), 이론상 베스트 (7.10)
// 랩 코스: 출발 게이트 통과부터 다음 통과까지. 편도: 출발 게이트부터 도착 게이트까지.
import { config } from '../config';
import type { CourseGeometry } from './geometry';
import { GateDetector, type GateCrossing } from './gates';
import { STracker } from './sTracker';

export interface FrameTrack {
  n: number;
  /** 세션 시계 ms */
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
  /** m/s */
  v: Float64Array;
}

export type InvalidReason = 'coverage' | 'distance' | 'gps_lost' | 'off_course' | 'interrupted';

export interface LapResult {
  lapNo: number;
  /** 세션 시계 ms */
  startT: number;
  endT: number;
  lapTimeMs: number;
  sectorTimesMs: [number | null, number | null, number | null];
  valid: boolean;
  invalidReason: InvalidReason | null;
  /** m/s */
  maxSpeed: number;
  distanceM: number;
}

export interface SplitResult {
  laps: LapResult[];
  crossings: GateCrossing[];
  /** 프레임마다 코스 거리 (모르면 NaN) */
  frameS: Float64Array;
  /** 프레임마다 랩 번호 (랩 밖이면 0) */
  frameLap: Int32Array;
  offCourse: Uint8Array;
}

export function splitLaps(input: {
  geom: CourseGeometry;
  track: FrameTrack;
  /** GPS 수신 시각들 (끊김 판정) */
  gpsTimes: number[];
  /** 앱이 중단됐던 구간 [시작, 끝] (사양서 9장) */
  pauses: Array<[number, number]>;
}): SplitResult {
  const { geom, track } = input;
  const n = track.n;
  const det = new GateDetector(geom);
  const st = new STracker(geom);
  const frameS = new Float64Array(n).fill(Number.NaN);
  const frameLap = new Int32Array(n);
  const offCourse = new Uint8Array(n);
  const crossings: GateCrossing[] = [];

  for (let k = 0; k < n; k++) {
    for (const c of det.push(track.t[k]!, track.x[k]!, track.y[k]!)) {
      crossings.push(c);
      if (c.gate === 'start') st.resetAtStart();
    }
    const r = st.update(track.x[k]!, track.y[k]!, track.v[k]!, track.t[k]!);
    frameS[k] = r.s ?? Number.NaN;
    offCourse[k] = r.onCourse ? 0 : 1;
  }

  // 랩 구간
  const windows: Array<[number, number]> = [];
  if (geom.course.kind === 'loop') {
    const starts = crossings.map((c) => c.t);
    for (let i = 0; i + 1 < starts.length; i++) windows.push([starts[i]!, starts[i + 1]!]);
  } else {
    let pending: number | null = null;
    for (const c of crossings) {
      if (c.gate === 'start') pending = c.t;
      else if (pending !== null) {
        windows.push([pending, c.t]);
        pending = null;
      }
    }
  }

  const gps = [...input.gpsTimes].sort((a, b) => a - b);
  const laps = windows.map(([t0, t1], i) => {
    const lap = evaluateLap(i + 1, t0, t1, geom, track, frameS, offCourse, gps, input.pauses);
    for (let k = 0; k < n; k++) if (track.t[k]! >= t0 && track.t[k]! <= t1) frameLap[k] = i + 1;
    return lap;
  });
  return { laps, crossings, frameS, frameLap, offCourse };
}

function lerpAt(track: FrameTrack, t: number): { x: number; y: number } {
  let lo = 0;
  let hi = track.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track.t[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const span = track.t[hi]! - track.t[lo]!;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - track.t[lo]!) / span)) : 0;
  return {
    x: track.x[lo]! + (track.x[hi]! - track.x[lo]!) * f,
    y: track.y[lo]! + (track.y[hi]! - track.y[lo]!) * f,
  };
}

function evaluateLap(
  lapNo: number,
  t0: number,
  t1: number,
  geom: CourseGeometry,
  track: FrameTrack,
  frameS: Float64Array,
  offCourse: Uint8Array,
  gps: number[],
  pauses: Array<[number, number]>,
): LapResult {
  const lc = config.laps;
  const idx: number[] = [];
  for (let k = 0; k < track.n; k++) if (track.t[k]! >= t0 && track.t[k]! <= t1) idx.push(k);

  // 이동 거리 (양 끝은 통과 지점까지 보간)
  let dist = 0;
  let prev = lerpAt(track, t0);
  for (const k of idx) {
    dist += Math.hypot(track.x[k]! - prev.x, track.y[k]! - prev.y);
    prev = { x: track.x[k]!, y: track.y[k]! };
  }
  const end = lerpAt(track, t1);
  dist += Math.hypot(end.x - prev.x, end.y - prev.y);

  let maxSpeed = 0;
  for (const k of idx) maxSpeed = Math.max(maxSpeed, track.v[k]!);

  // 구간 경계 통과 시각 (프레임 사이 보간)
  const sectors: [number | null, number | null, number | null] = [null, null, null];
  const L = geom.centerline?.length ?? null;
  if (geom.sectorBounds) {
    const times: Array<number | null> = geom.sectorBounds.map((b) => {
      for (let j = 1; j < idx.length; j++) {
        const a = frameS[idx[j - 1]!]!;
        const c = frameS[idx[j]!]!;
        if (Number.isNaN(a) || Number.isNaN(c) || c - a > 50 || c < a) continue;
        if (a < b && c >= b) {
          const f = (b - a) / (c - a);
          return track.t[idx[j - 1]!]! + f * (track.t[idx[j]!]! - track.t[idx[j - 1]!]!);
        }
      }
      return null;
    });
    const [s1, s2] = times;
    if (s1 != null) sectors[0] = s1 - t0;
    if (s1 != null && s2 != null) sectors[1] = s2 - s1;
    if (s2 != null) sectors[2] = t1 - s2;
  }

  // 유효 판정 (사유는 이 순서로 하나만)
  let reason: InvalidReason | null = null;
  const overlaps = (a: number, b: number) => a < t1 && b > t0;
  if (pauses.some(([a, b]) => overlaps(a, b))) reason = 'interrupted';
  if (!reason) {
    const inLap = gps.filter((g) => g >= t0 && g <= t1);
    let gap = inLap.length === 0;
    for (let i = 1; i < gps.length && !gap; i++) {
      if (gps[i]! - gps[i - 1]! > lc.maxGpsGapS * 1000 && overlaps(gps[i - 1]!, gps[i]!)) gap = true;
    }
    if (gap) reason = 'gps_lost';
  }
  if (!reason && idx.some((k) => offCourse[k] === 1)) reason = 'off_course';
  if (!reason && L !== null) {
    const bins = Math.max(1, Math.ceil(L / lc.coverageBinM));
    const seen = new Uint8Array(bins);
    let last: number | null = null;
    for (const k of idx) {
      const s = frameS[k]!;
      if (Number.isNaN(s) || offCourse[k]) continue;
      const mark = (v: number) => {
        seen[Math.min(bins - 1, Math.max(0, Math.floor(v / lc.coverageBinM)))] = 1;
      };
      mark(s);
      // 프레임 사이 짧은 진행은 사이 칸도 지난 것으로 본다
      if (last !== null && s > last && s - last < 30) for (let v = last; v < s; v += lc.coverageBinM) mark(v);
      last = s;
    }
    const coverage = seen.reduce((a, b) => a + b, 0) / bins;
    if (coverage < lc.minCoverage) reason = 'coverage';
    else if (Math.abs(dist - L) / L > lc.distanceTolerance) reason = 'distance';
  }

  return {
    lapNo,
    startT: t0,
    endT: t1,
    lapTimeMs: t1 - t0,
    sectorTimesMs: sectors,
    valid: reason === null,
    invalidReason: reason,
    maxSpeed,
    distanceM: dist,
  };
}

/** 유효 랩에서 구간별 최소 기록의 합 (사양서 7.10) */
export function theoreticalBest(laps: LapResult[]): {
  sectorsMs: [number, number, number] | null;
  totalMs: number | null;
} {
  const full = laps.filter((l) => l.valid && l.sectorTimesMs.every((v) => v !== null));
  if (full.length === 0) return { sectorsMs: null, totalMs: null };
  const best = [0, 1, 2].map((i) => Math.min(...full.map((l) => l.sectorTimesMs[i]!))) as [number, number, number];
  return { sectorsMs: best, totalMs: best[0] + best[1] + best[2] };
}
