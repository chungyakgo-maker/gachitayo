// 코스 만들기·고치기: 평면 중심선 → 저장 형식, 코스 다듬기(7.5), 출발선·도착선 옮기기(질문 5 결정)
import { config } from '../config';
import { wrapAngle } from '../linalg';
import type { Course, Gate } from '../../types/course';
import { toLocal } from '../geo';
import { buildGeometry, centerlineToLatLon, gateFromPoint, sectorBounds } from './geometry';
import {
  makePolyline,
  nearestOnPolyline,
  polylinePoint,
  resamplePolyline,
  rotateClosed,
  slicePolyline,
  smoothPath,
  type Polyline,
} from './polyline';

const cfg = config.course;

/** 평면 경로 → 매끄럽게 다듬은 1 m 중심선 (smooth=false면 간격만 맞춘다: 이미 다듬은 중심선) */
export function centerlineFromPath(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  closed: boolean,
  smooth = true,
): Polyline {
  const x = Array.from(xs);
  const y = Array.from(ys);
  if (closed && x.length > 1) {
    x.push(x[0]!);
    y.push(y[0]!);
  }
  const sm = smooth ? smoothPath(x, y, cfg.centerlineSmoothM, closed) : { x, y };
  return resamplePolyline(makePolyline(sm.x, sm.y), cfg.centerlineSpacingM);
}

/** 평면 중심선으로 코스 저장 형식의 중심선·길이·구간을 채운다 */
export function withCenterline(course: Course, p: Polyline): Course {
  // 길이는 저장하는(소수 7자리로 반올림한) 중심선 기준으로 계산해, 다시 불러온 기하와 같게 한다
  const ll = centerlineToLatLon(p, course.origin);
  const local = ll.map(([lat, lon]) => toLocal(course.origin, lat, lon));
  const stored = makePolyline(local.map((q) => q.x), local.map((q) => q.y));
  return { ...course, centerline: ll, lengthM: stored.length, sectorBoundsM: sectorBounds(stored.length) };
}

/** 랩 코스 중심선이 출발선(가장 가까운 점)에서 시작하도록 돌린다 */
export function startLoopAtGate(p: Polyline, gx: number, gy: number): Polyline {
  return rotateClosed(p, nearestOnPolyline(p, gx, gy).s, cfg.centerlineSpacingM);
}

/**
 * 코스 다듬기 (사양서 7.5): 유효 랩 경로(출발선→출발선 또는 출발→도착, 코스 평면 좌표)를
 * 경로 길이 비율로 맞춰 평균한 뒤 다듬는다. version +1.
 */
export function refineCourse(
  course: Course,
  lapPaths: Array<{ x: ArrayLike<number>; y: ArrayLike<number> }>,
  opts: { minLaps: number } = { minLaps: cfg.refineMinLaps },
): Course {
  if (lapPaths.length < opts.minLaps) {
    throw new Error(`코스 다듬기에는 유효 랩이 ${opts.minLaps}개 이상 필요합니다`);
  }
  const polys = lapPaths.map((p) => makePolyline(p.x, p.y));
  const N = Math.max(10, Math.round(polys.reduce((a, p) => a + p.length, 0) / polys.length / cfg.centerlineSpacingM));
  const ax = new Float64Array(N + 1);
  const ay = new Float64Array(N + 1);
  for (const p of polys) {
    for (let i = 0; i <= N; i++) {
      const q = polylinePoint(p, (p.length * i) / N);
      ax[i] += q.x / polys.length;
      ay[i] += q.y / polys.length;
    }
  }
  const loop = course.kind === 'loop';
  let cl = centerlineFromPath(loop ? ax.subarray(0, N) : ax, loop ? ay.subarray(0, N) : ay, loop);
  if (loop) {
    const g = buildGeometry(course).start;
    cl = startLoopAtGate(cl, g.cx, g.cy);
  }
  return { ...withCenterline(course, cl), version: course.version + 1 };
}

function movedGate(old: Gate, p: { x: number; y: number; psi: number }, course: Course): Gate {
  return gateFromPoint(p.x, p.y, p.psi, course.origin, old.widthM);
}

/**
 * 출발선·도착선 옮기기 (질문 5 결정): 중심선에서 가장 가까운 곳으로 붙인다.
 * 랩 코스는 중심선 시작을 새 출발선으로 돌리고, 편도는 출발 앞·도착 뒤를 잘라낸다. version +1.
 */
export function moveGate(course: Course, which: 'start' | 'finish', x: number, y: number): Course {
  const cl = buildGeometry(course).centerline;
  if (!cl) throw new Error('중심선이 없는 코스는 첫 주행 뒤에 선을 옮길 수 있습니다');
  const s = nearestOnPolyline(cl, x, y).s;
  const p = polylinePoint(cl, s);
  if (course.kind === 'loop') {
    const gate = movedGate(course.startGate, p, course);
    return { ...withCenterline({ ...course, startGate: gate, finishGate: gate }, rotateClosed(cl, s, cfg.centerlineSpacingM)), version: course.version + 1 };
  }
  if (which === 'start') {
    const gate = movedGate(course.startGate, p, course);
    return { ...withCenterline({ ...course, startGate: gate }, slicePolyline(cl, s, cl.length, cfg.centerlineSpacingM)), version: course.version + 1 };
  }
  const gate = movedGate(course.finishGate, p, course);
  return { ...withCenterline({ ...course, finishGate: gate }, slicePolyline(cl, 0, s, cfg.centerlineSpacingM)), version: course.version + 1 };
}

export const headingDiff = (a: number, b: number) => Math.abs(wrapAngle(a - b));
