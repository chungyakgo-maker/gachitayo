// 첫 주행 자동 코스 생성 (사양서 7.5, 질문 3·4 결정)
//
// 랩 코스: 500 m 이상 달린 뒤, 이전에 지났던 어느 지점이든 30 m 이내·진행 방향 45° 이내로 다시 지나면 랩 코스.
//   그 뒤 100 m 안에서 이전 경로와 8 m 안으로 실제로 겹치는 첫 지점을 출발선으로 한다
//   (피트 진입로가 아니라 트랙 위. 겹치지 않으면 헤어핀 옆 다리 같은 우연한 근접이라 랩으로 보지 않는다).
//   중심선은 그 지점의 첫 통과부터 두 번째 통과까지(첫 랩).
//   단, 그 첫 랩이 같은 길을 반대로 되짚은 경로(올라갔다 내려와 다시 올라감)를 품거나,
//   앱 중단·GPS 끊김 구간에 걸치면 랩 코스 후보로 보지 않는다 (M4 검토 결정).
// 편도: 첫 1회 주행. 처음 3 m/s를 넘은 지점부터, 같은 길을 되짚기 시작한 곳(되돌아선 곳)
//   (U턴을 시작한 곳: 가는 길 중 돌아오는 길과 겹치는 마지막 지점) 또는 끝나기 전 마지막 3 m/s 이상 지점까지. 출발선·도착선은 그 양 끝에서 20 m씩 안쪽에 둔다
//   (정차 위치와 GPS 오차 안에 있으면 다음 주행에서 출발·도착이 잡히지 않는다. M4 검토 결정).
// 사용자가 종료 화면에서 종류를 고르면(사양서 8.5) 그 종류로만 찾는다.
import { config } from '../config';
import type { LatLon } from '../geo';
import { wrapAngle } from '../linalg';
import type { SmoothedTrack } from '../fusion/smoother';
import type { CourseKind, Gate } from '../../types/course';
import { centerlineFromPath, startLoopAtGate } from './edit';
import { gateFromPoint } from './geometry';
import type { Polyline } from './polyline';

const cfg = config.course.auto;
const DEG = Math.PI / 180;
const SAMPLE_STEP_M = 2;
const MIN_COURSE_M = 50;
/** 되짚음: 이 거리 안, 진행 방향이 반대(135° 넘게 차이)인 예전 지점 */
const RETRACE_M = 10;
const RETRACE_OPPOSITE_DEG = 135;
/** 그 예전 지점이 이만큼 이상 앞서 지난 곳이어야 한다 (헤어핀 자체는 제외) */
const RETRACE_MIN_BACK_M = 100;
/** 이만큼 이어져야 되짚음으로 본다 */
const RETRACE_MIN_RUN_M = 50;
/** U턴(되돌아서는 동작)이 차지하는 주행 거리의 상한 */
const TURN_MAX_M = 30;

export interface DetectOptions {
  /** 사용자가 고른 코스 종류 (주행 종료 확인, 사양서 8.5). 없으면 자동 판정 */
  kind?: CourseKind;
  /** 중심선으로 쓰면 안 되는 구간 (앱 중단, GPS 5초 넘게 끊김) [시작, 끝] 세션 시계 ms */
  exclude?: Array<[number, number]>;
}

export interface DetectedCourse {
  kind: CourseKind;
  startGate: Gate;
  finishGate: Gate;
  /** 코스 원점 기준 평면 좌표 */
  centerline: Polyline;
  /** 중심선을 만든 구간 (세션 시계 ms) */
  lapRange: [number, number];
}

interface Sample {
  /** 표본 번호 */
  i: number;
  /** 궤적 번호 */
  k: number;
  x: number;
  y: number;
  psi: number;
  d: number;
  t: number;
}

export function detectCourse(track: SmoothedTrack, origin: LatLon, opts: DetectOptions = {}): DetectedCourse | null {
  if (track.n < 2) return null;
  const tAt = (k: number) => track.t0 + k * track.dt;
  // 2 m마다 표본
  const samples: Sample[] = [];
  let d = 0;
  let lastD = -Infinity;
  for (let k = 0; k < track.n; k++) {
    if (k > 0) d += Math.hypot(track.x[k]! - track.x[k - 1]!, track.y[k]! - track.y[k - 1]!);
    if (d - lastD >= SAMPLE_STEP_M) {
      samples.push({ i: samples.length, k, x: track.x[k]!, y: track.y[k]!, psi: track.psi[k]!, d, t: tAt(k) });
      lastD = d;
    }
  }
  const retrace = findRetrace(samples);
  if (opts.kind !== 'point_to_point') {
    const loop = detectLoop(track, samples, origin, retrace, opts.exclude ?? []);
    if (loop || opts.kind === 'loop') return loop;
  }
  return detectPointToPoint(track, samples, origin, retrace);
}

interface Retrace {
  /** 되짚은 구간이 품은 예전 지점 중 가장 늦은 것의 거리 (표본마다 누적 최댓값). 없으면 −∞ */
  prefixBackD: Float64Array;
  /** 처음 되짚기 시작한 곳: [지금 표본, 그와 겹치는 예전 표본] */
  first: { j: Sample; k: Sample } | null;
}

/** 같은 길을 반대 방향으로 되짚은 곳 찾기 (편도 왕복의 특징) */
function findRetrace(samples: Sample[]): Retrace {
  const C = RETRACE_M;
  const grid = new Map<string, Sample[]>();
  const match: Array<Sample | null> = samples.map(() => null);
  for (const j of samples) {
    const cx = Math.floor(j.x / C);
    const cy = Math.floor(j.y / C);
    let best: { k: Sample; dist: number } | null = null;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const k of grid.get(`${cx + a},${cy + b}`) ?? []) {
          if (j.d - k.d < RETRACE_MIN_BACK_M) continue;
          const dist = Math.hypot(j.x - k.x, j.y - k.y);
          if (dist > C || Math.abs(wrapAngle(j.psi - k.psi)) < RETRACE_OPPOSITE_DEG * DEG) continue;
          if (!best || dist < best.dist) best = { k, dist };
        }
    match[j.i] = best?.k ?? null;
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(j);
    else grid.set(key, [j]);
  }
  // RETRACE_MIN_RUN_M 넘게 이어진 것만 (표본 2개까지 빠져도 이어진 것으로 본다)
  const prefixBackD = new Float64Array(samples.length).fill(-Infinity);
  let first: Retrace['first'] = null;
  let runStart = -1;
  let lastHit = -1;
  const inRun = new Uint8Array(samples.length);
  const close = () => {
    if (runStart >= 0 && samples[lastHit]!.d - samples[runStart]!.d >= RETRACE_MIN_RUN_M) {
      for (let q = runStart; q <= lastHit; q++) if (match[q]) inRun[q] = 1;
      first ??= { j: samples[runStart]!, k: match[runStart]! };
    }
    runStart = -1;
  };
  for (let q = 0; q < samples.length; q++) {
    if (!match[q]) continue;
    if (runStart >= 0 && q - lastHit > 3) close();
    if (runStart < 0) runStart = q;
    lastHit = q;
  }
  close();
  let m = -Infinity;
  for (let q = 0; q < samples.length; q++) {
    if (inRun[q]) m = Math.max(m, match[q]!.d);
    prefixBackD[q] = m;
  }
  return { prefixBackD, first };
}

function detectLoop(
  track: SmoothedTrack,
  samples: Sample[],
  origin: LatLon,
  retrace: Retrace,
  exclude: Array<[number, number]>,
): DetectedCourse | null {
  const R = cfg.loopReturnRadiusM;
  const cell = (x: number, y: number) => `${Math.floor(x / R)},${Math.floor(y / R)}`;
  const grid = new Map<string, Sample[]>();
  /** j와 이전 표본 중 조건을 만족하는 가장 가까운 것 */
  const nearestEarlier = (j: Sample): { k: Sample; dist: number } | null => {
    let best: { k: Sample; dist: number } | null = null;
    const cx = Math.floor(j.x / R);
    const cy = Math.floor(j.y / R);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const k of grid.get(`${cx + a},${cy + b}`) ?? []) {
          if (k.d > j.d - cfg.loopMinTravelM) continue;
          const dist = Math.hypot(j.x - k.x, j.y - k.y);
          if (dist > R || Math.abs(wrapAngle(j.psi - k.psi)) > cfg.loopHeadingDeg * DEG) continue;
          if (!best || dist < best.dist) best = { k, dist };
        }
    return best;
  };

  for (let j = 0; j < samples.length; j++) {
    const s = samples[j]!;
    if (nearestEarlier(s)) {
      // 처음 돌아온 곳에서 100 m 안에 이전 경로와 8 m 안으로 겹치는 첫 지점
      let pick: { j: Sample; k: Sample } | null = null;
      for (let q = j; q < samples.length && samples[q]!.d - s.d <= cfg.loopRefineM; q++) {
        const m = nearestEarlier(samples[q]!);
        if (m && m.dist <= cfg.loopMatchM) {
          pick = { j: samples[q]!, k: m.k };
          break;
        }
      }
      // 첫 랩 후보가 되짚은 길을 품거나(편도를 여러 번) 앱 중단·GPS 끊김에 걸치면 쓰지 않는다
      const usable =
        pick !== null &&
        retrace.prefixBackD[pick.j.i]! < pick.k.d &&
        !exclude.some(([a, b]) => a < pick.j.t && b > pick.k.t);
      if (!pick || !usable) {
        grid.set(cell(s.x, s.y), [...(grid.get(cell(s.x, s.y)) ?? []), s]);
        continue;
      }
      const xs = track.x.slice(pick.k.k, pick.j.k + 1);
      const ys = track.y.slice(pick.k.k, pick.j.k + 1);
      let cl = centerlineFromPath(xs, ys, true);
      if (cl.length < MIN_COURSE_M) return null;
      cl = startLoopAtGate(cl, pick.j.x, pick.j.y);
      const gate = gateFromPoint(pick.j.x, pick.j.y, pick.j.psi, origin);
      return { kind: 'loop', startGate: gate, finishGate: gate, centerline: cl, lapRange: [pick.k.t, pick.j.t] };
    }
    const key = cell(s.x, s.y);
    const list = grid.get(key);
    if (list) list.push(s);
    else grid.set(key, [s]);
  }
  return null;
}

/**
 * 가는 길이 끝나는 곳 (U턴을 시작한 곳): 되짚기 시작한 지점(j)과 그와 겹치는 예전 지점(k) 사이에서
 * k에서 가장 먼 곳이 U턴 끝. 그 앞의 가는 길 중 돌아오는 길(U턴 끝 뒤)과 겹치는 마지막 지점.
 */
function turnStart(samples: Sample[], first: { j: Sample; k: Sample }): Sample {
  const { j, k } = first;
  let tip = k;
  for (let q = k.i; q <= j.i; q++) {
    const p = samples[q]!;
    if (Math.hypot(p.x - k.x, p.y - k.y) > Math.hypot(tip.x - k.x, tip.y - k.y)) tip = p;
  }
  // U턴 자체는 이보다 길지 않다. 후진을 섞어 돌면(3점 회전) 융합 궤적이 돌아오는 길을 한참 옆으로 그릴 수 있어서
  // 겹치는 곳만 보면 너무 앞이 된다
  let limit = tip;
  while (limit.i > k.i && tip.d - limit.d < TURN_MAX_M) limit = samples[limit.i - 1]!;
  for (let q = tip.i; q > limit.i; q--) {
    const out = samples[q]!;
    for (let r = tip.i; r <= j.i; r++) {
      const back = samples[r]!;
      if (
        Math.hypot(out.x - back.x, out.y - back.y) <= RETRACE_M &&
        Math.abs(wrapAngle(out.psi - back.psi)) >= RETRACE_OPPOSITE_DEG * DEG
      )
        return out;
    }
  }
  return limit;
}

function detectPointToPoint(track: SmoothedTrack, samples: Sample[], origin: LatLon, retrace: Retrace): DetectedCourse | null {
  const n = track.n;
  let a = -1;
  for (let k = 0; k < n; k++)
    if (track.v[k]! > cfg.startSpeedMps) {
      a = k;
      break;
    }
  if (a < 0) return null;
  let b = -1;
  if (retrace.first && retrace.first.k.k > a) {
    b = turnStart(samples, retrace.first).k;
  } else {
    for (let k = n - 1; k > a; k--)
      if (track.v[k]! >= cfg.startSpeedMps) {
        b = k;
        break;
      }
  }
  if (b <= a) return null;
  // 양 끝에서 20 m씩 안쪽
  const cum = new Float64Array(n);
  for (let k = 1; k < n; k++) cum[k] = cum[k - 1]! + Math.hypot(track.x[k]! - track.x[k - 1]!, track.y[k]! - track.y[k - 1]!);
  let ai = a;
  while (ai < b && cum[ai]! - cum[a]! < cfg.p2pGateInsetM) ai++;
  let bi = b;
  while (bi > ai && cum[b]! - cum[bi]! < cfg.p2pGateInsetM) bi--;
  if (bi <= ai) return null;
  const cl = centerlineFromPath(track.x.slice(ai, bi + 1), track.y.slice(ai, bi + 1), false);
  if (cl.length < MIN_COURSE_M) return null;
  return {
    kind: 'point_to_point',
    startGate: gateFromPoint(track.x[ai]!, track.y[ai]!, track.psi[ai]!, origin),
    finishGate: gateFromPoint(track.x[bi]!, track.y[bi]!, track.psi[bi]!, origin),
    centerline: cl,
    lapRange: [track.t0 + ai * track.dt, track.t0 + bi * track.dt],
  };
}
