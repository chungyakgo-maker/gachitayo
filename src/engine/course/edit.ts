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

/** 코스 선 위 a→b 현의 방향 ψ (rad) */
export function chordPsi(cl: Polyline, a: number, b: number): number {
  const p = polylinePoint(cl, a);
  const q = polylinePoint(cl, b);
  return Math.atan2(q.y - p.y, q.x - p.x);
}

/**
 * 경로 양 끝의 짧은 진입로 건너뛰기 (사용자 요청 "북악 출발선 고쳐"): 카카오맵 경로는 출발·도착 표시 지점에서
 * 도로까지 몇 m를 엉뚱한 방향으로 잇는다. 그 끝에 게이트를 두면 선 방향이 도로와 어긋나 랩이 안 잡힌다.
 * 끝에서 안쪽으로 1 m씩 들어가며, 앞으로 windowM 동안 방향이 그 현 방향과 tolDeg 안인 첫 자리를 고른다.
 * maxTrimM 안에 없으면 그 끝은 그대로. 너무 짧은 코스는 그대로.
 */
export function straightEnds(cl: Polyline, o: { windowM: number; tolDeg: number; maxTrimM: number } = cfg.gpxEnds): { s0: number; s1: number } {
  const L = cl.length;
  if (!(L >= 2 * (o.maxTrimM + o.windowM) + 100)) return { s0: 0, s1: L };
  const tol = (o.tolDeg * Math.PI) / 180;
  const straight = (a: number, b: number) => {
    const c = chordPsi(cl, a, b);
    // 1 m 걸음마다의 현 방향 (중심선 점이 1 m 칸에 딱 맞지 않아도 잘라 낸 선의 첫 칸과 같게)
    for (let t = a; t + 1 <= b + 1e-9; t += 1) if (Math.abs(wrapAngle(chordPsi(cl, t, t + 1) - c)) > tol) return false;
    return true;
  };
  let s0 = 0;
  while (s0 <= o.maxTrimM && !straight(s0, s0 + o.windowM)) s0++;
  if (s0 > o.maxTrimM) s0 = 0;
  let e = 0;
  while (e <= o.maxTrimM && !straight(L - e - o.windowM, L - e)) e++;
  if (e > o.maxTrimM) e = 0;
  return { s0, s1: L - e };
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

/** 역방향 코스 이름: "만항재" ↔ "만항재 역방향" (40자 이내) */
export const REVERSE_SUFFIX = ' 역방향';
export function reverseName(name: string): string {
  if (name.endsWith(REVERSE_SUFFIX)) return name.slice(0, -REVERSE_SUFFIX.length).trim() || name;
  return `${name.slice(0, 40 - REVERSE_SUFFIX.length)}${REVERSE_SUFFIX}`;
}

/**
 * 역방향 코스 (사용자 요청): 같은 길을 반대로 달리는 새 코스. 원래 코스와 그 기록은 그대로 둔다.
 * 편도는 출발·도착을 맞바꾸고, 랩은 출발선 자리는 그대로 방향만 반대. 선의 진행 방향도 반대로. version 1
 */
export function reverseCourse(course: Course, opts: { id: string; name: string }): Course {
  const flip = (g: Gate): Gate => ({ ...g, bearingDeg: (g.bearingDeg + 180) % 360 });
  const loop = course.kind === 'loop';
  const startGate = loop ? flip(course.startGate) : flip(course.finishGate);
  const base: Course = {
    id: opts.id,
    name: opts.name,
    kind: course.kind,
    source: course.source,
    origin: course.origin,
    startGate,
    finishGate: loop ? startGate : flip(course.startGate),
    centerline: null,
    lengthM: null,
    sectorBoundsM: null,
    version: 1,
  };
  const cl = buildGeometry(course).centerline;
  if (!cl) return base;
  const n = cl.x.length;
  // 랩은 첫 점(출발선)을 그대로 두고 나머지를 거꾸로, 편도는 통째로 거꾸로
  const idx = loop ? [0, ...Array.from({ length: n - 1 }, (_, k) => n - 1 - k)] : Array.from({ length: n }, (_, k) => n - 1 - k);
  return withCenterline(base, makePolyline(idx.map((i) => cl.x[i]!), idx.map((i) => cl.y[i]!)));
}

/** 같은 코스인지 (종류가 같고 출발선·도착선이 30 m 안, 방향 차이 60° 안). 역방향을 두 번 만들지 않으려고 */
export function sameCourse(a: Course, b: Course): boolean {
  if (a.kind !== b.kind) return false;
  const near = (g: Gate, h: Gate) => {
    const p = toLocal(g, h.lat, h.lon);
    const d = Math.abs(((g.bearingDeg - h.bearingDeg + 540) % 360) - 180);
    return Math.hypot(p.x, p.y) <= 30 && d <= 60;
  };
  return near(a.startGate, b.startGate) && near(a.finishGate, b.finishGate);
}
