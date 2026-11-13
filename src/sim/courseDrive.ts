// 모의주행 (사양서 10.2, 사용자 요청 "코스를 미리 보고 싶을 때"): 코스 중심선을 가상 코스로 만들어 가상의 차가 한 번 달린
// GPS·모션을 만든다. 편도는 출발 → 도착, 랩 코스는 한 바퀴. 비교 랩은 쓰지 않는다.
import { toLocal } from '../engine/geo';
import type { Course } from '../types/course';
import type { GpsSample, RawMotionSample } from '../types/samples';
import { simulateDrive } from './drive';
import { defaultSensorOpts, G, synthesizeSensors } from './sensors';
import { polylineTrack } from './track';

/** 가상 차 (사양서 10.2): 최고 80 km/h, 커브는 옆 방향 0.3 g 안. 출발 전 3초·도착 뒤 2초 정차 */
export const COURSE_SIM = {
  vMax: 80 / 3.6,
  aLatMax: 0.3 * G,
  aAccel: 2,
  aBrake: 3,
  startStopS: 3,
  endStopS: 2,
  /** 출발선을 실제로 지나도록 출발선 앞에 붙이는 직선 (m) */
  leadInM: 60,
  /** 도착선(랩 코스는 출발선)을 지나 더 가는 거리 (m) */
  leadOutM: 40,
} as const;

type XY = [number, number];

/** a에서 b 쪽으로 d m 간 점 */
const along = (a: XY, b: XY, d: number): XY => {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [a[0] + ((b[0] - a[0]) / L) * d, a[1] + ((b[1] - a[1]) / L) * d];
};

/** pts[from]에서 step(±1) 방향으로 최소 minM m 떨어진 첫 점 (없으면 끝 점) */
function pointAway(pts: XY[], from: number, step: 1 | -1, minM: number): XY {
  for (let i = from + step; i >= 0 && i < pts.length; i += step) {
    if (Math.hypot(pts[i]![0] - pts[from]![0], pts[i]![1] - pts[from]![1]) >= minM) return pts[i]!;
  }
  return pts[step > 0 ? pts.length - 1 : 0]!;
}

export function simulateCourseDrive(course: Course, seed = 11): { gps: GpsSample[]; motion: RawMotionSample[]; durationMs: number } {
  const cl = course.centerline;
  if (!cl || cl.length < 2) throw new Error('코스 선이 없어 모의주행을 할 수 없어요');
  const pts: XY[] = cl.map(([lat, lon]) => {
    const p = toLocal(course.origin, lat, lon);
    return [p.x, p.y];
  });
  const start = pts[0]!;
  // 출발선 앞 직선: 처음 10 m 방향의 반대로
  const leadIn = along(start, pointAway(pts, 0, 1, 10), -COURSE_SIM.leadInM);
  let body: XY[];
  if (course.kind === 'loop') {
    // 한 바퀴 돌아 출발선을 다시 지나고, 코스를 따라 조금 더 간다
    const more: XY[] = [];
    let d = 0;
    for (let i = 1; i < pts.length && d < COURSE_SIM.leadOutM; i++) {
      d += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      more.push(pts[i]!);
    }
    body = [...pts, start, ...more];
  } else {
    const end = pts[pts.length - 1]!;
    const before = pointAway(pts, pts.length - 1, -1, 10);
    body = [...pts, along(before, end, Math.hypot(end[0] - before[0], end[1] - before[1]) + COURSE_SIM.leadOutM)];
  }
  const track = polylineTrack([leadIn, ...body]);
  const truth = simulateDrive(track, {
    laps: 1,
    startStopS: COURSE_SIM.startStopS,
    endStopS: COURSE_SIM.endStopS,
    vMax: COURSE_SIM.vMax,
    aLatMax: COURSE_SIM.aLatMax,
    aAccel: COURSE_SIM.aAccel,
    aBrake: COURSE_SIM.aBrake,
  });
  const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed, origin: course.origin });
  return { gps: s.gps, motion: s.motion, durationMs: truth.t[truth.t.length - 1]! * 1000 };
}
