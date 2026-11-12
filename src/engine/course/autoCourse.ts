// 첫 주행 자동 코스 생성 (사양서 7.5, 질문 3·4 결정)
//
// 랩 코스: 500 m 이상 달린 뒤, 이전에 지났던 어느 지점이든 30 m 이내·진행 방향 45° 이내로 다시 지나면 랩 코스.
//   그 뒤 100 m 안에서 이전 경로와 8 m 안으로 실제로 겹치는 첫 지점을 출발선으로 한다
//   (피트 진입로가 아니라 트랙 위. 겹치지 않으면 헤어핀 옆 다리 같은 우연한 근접이라 랩으로 보지 않는다).
//   중심선은 그 지점의 첫 통과부터 두 번째 통과까지(첫 랩).
// 편도: 출발선 = 처음 3 m/s를 넘은 지점. 도착선 = 끝나기 전 마지막 3 m/s 이상 지점,
//   그 점이 출발점 30 m 안이면(왕복) 출발점에서 직선거리로 가장 먼 지점.
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
  k: number;
  x: number;
  y: number;
  psi: number;
  d: number;
  t: number;
}

export function detectCourse(track: SmoothedTrack, origin: LatLon): DetectedCourse | null {
  if (track.n < 2) return null;
  const tAt = (k: number) => track.t0 + k * track.dt;
  // 2 m마다 표본
  const samples: Sample[] = [];
  let d = 0;
  let lastD = -Infinity;
  for (let k = 0; k < track.n; k++) {
    if (k > 0) d += Math.hypot(track.x[k]! - track.x[k - 1]!, track.y[k]! - track.y[k - 1]!);
    if (d - lastD >= SAMPLE_STEP_M) {
      samples.push({ k, x: track.x[k]!, y: track.y[k]!, psi: track.psi[k]!, d, t: tAt(k) });
      lastD = d;
    }
  }
  return detectLoop(track, samples, origin) ?? detectPointToPoint(track, origin);
}

function detectLoop(track: SmoothedTrack, samples: Sample[], origin: LatLon): DetectedCourse | null {
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
      if (!pick) {
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

function detectPointToPoint(track: SmoothedTrack, origin: LatLon): DetectedCourse | null {
  const n = track.n;
  let a = -1;
  for (let k = 0; k < n; k++)
    if (track.v[k]! > cfg.startSpeedMps) {
      a = k;
      break;
    }
  if (a < 0) return null;
  let b = -1;
  for (let k = n - 1; k > a; k--)
    if (track.v[k]! >= cfg.startSpeedMps) {
      b = k;
      break;
    }
  if (b < 0) return null;
  // 출발점 근처로 돌아와 끝났으면(왕복) 출발점에서 가장 먼 지점
  if (Math.hypot(track.x[b]! - track.x[a]!, track.y[b]! - track.y[a]!) <= cfg.loopReturnRadiusM) {
    let far = a;
    let farD = 0;
    for (let k = a; k <= b; k++) {
      const dd = Math.hypot(track.x[k]! - track.x[a]!, track.y[k]! - track.y[a]!);
      if (dd > farD) {
        farD = dd;
        far = k;
      }
    }
    b = far;
  }
  const cl = centerlineFromPath(track.x.slice(a, b + 1), track.y.slice(a, b + 1), false);
  if (cl.length < MIN_COURSE_M) return null;
  return {
    kind: 'point_to_point',
    startGate: gateFromPoint(track.x[a]!, track.y[a]!, track.psi[a]!, origin),
    finishGate: gateFromPoint(track.x[b]!, track.y[b]!, track.psi[b]!, origin),
    centerline: cl,
    lapRange: [track.t0 + a * track.dt, track.t0 + b * track.dt],
  };
}
