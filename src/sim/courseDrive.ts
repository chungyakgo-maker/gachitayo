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
  /** 출발선을 실제로 지나도록 출발선 앞에 붙이는 직선 (m). 출발선 방향으로 들어온다 */
  leadInM: 30,
  /** 도착선(랩 코스는 출발선)을 지나 더 가는 거리 (m) */
  leadOutM: 40,
  /** 게이트 앞뒤로 게이트 방향 그대로 달리는 거리 (m). 코스 끝이 휘어 있어도 선을 똑바로 지나게 */
  gateStraightM: 20,
  /** 게이트 둘레에서 건너뛰는 코스 선 (m). 그 사이는 위 직선으로 잇는다 */
  gateSkipM: 25,
  /** 이은 길의 모서리를 둥글게 펴는 이동평균 창 (m, 두 번). 위치와 회전 센서 값이 어긋나지 않게 */
  smoothM: 15,
} as const;

type XY = [number, number];

/** 게이트 방향(나침반 각, 북쪽 0° 시계 방향)으로 d m 간 점. 평면 좌표는 x 동쪽, y 북쪽 */
const alongBearing = (p: XY, bearingDeg: number, d: number): XY => {
  const r = (bearingDeg * Math.PI) / 180;
  return [p[0] + Math.sin(r) * d, p[1] + Math.cos(r) * d];
};

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 1 m 간격으로 다시 나누고 이동평균(창 windowM, passes번)으로 모서리를 둥글게. 양 끝 점은 그대로 */
function smoothPath(pts: XY[], windowM: number, passes: number): XY[] {
  const out: XY[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.round(dist(a, b)));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  const h = Math.max(1, Math.round(windowM / 2));
  let cur = out;
  for (let pass = 0; pass < passes; pass++) {
    const next: XY[] = cur.map((p, i) => {
      if (i === 0 || i === cur.length - 1) return p;
      const lo = Math.max(0, i - h);
      const hi = Math.min(cur.length - 1, i + h);
      // 끝 가까이에서는 창을 좌우 같게 줄여 끝이 끌려가지 않게
      const w = Math.min(i - lo, hi - i);
      let sx = 0;
      let sy = 0;
      for (let k = i - w; k <= i + w; k++) {
        sx += cur[k]![0];
        sy += cur[k]![1];
      }
      return [sx / (2 * w + 1), sy / (2 * w + 1)];
    });
    cur = next;
  }
  return cur;
}

/** 게이트(g)에서 skip m 안의 점을 앞쪽(처음부터) 또는 뒤쪽(끝부터)에서 잘라 낸다 */
function trimAround(pts: XY[], g: XY, skip: number, fromEnd: boolean): XY[] {
  if (fromEnd) {
    let k = pts.length;
    while (k > 1 && dist(pts[k - 1]!, g) < skip) k--;
    return pts.slice(0, k);
  }
  let k = 0;
  while (k < pts.length - 1 && dist(pts[k]!, g) < skip) k++;
  return pts.slice(k);
}

export function simulateCourseDrive(course: Course, seed = 11): { gps: GpsSample[]; motion: RawMotionSample[]; durationMs: number } {
  const cl = course.centerline;
  if (!cl || cl.length < 2) throw new Error('코스 선이 없어 모의주행을 할 수 없어요');
  const pts: XY[] = cl.map(([lat, lon]) => {
    const p = toLocal(course.origin, lat, lon);
    return [p.x, p.y];
  });
  const start = pts[0]!;
  const end = pts[pts.length - 1]!;
  const sb = course.startGate.bearingDeg;
  const fb = course.finishGate.bearingDeg;
  const G = COURSE_SIM.gateStraightM;
  const skip = COURSE_SIM.gateSkipM;
  // 게이트는 코스 끝 1 m의 방향이라, 카카오맵 경로 끝이 휘어 있으면 코스 선을 그대로 달려서는 선을 비스듬히(거의 나란히) 지나
  // 통과가 안 잡힌다 (검토 지적: 기본 코스 11개 중 6개). 그래서 게이트 앞뒤 20 m는 게이트 방향으로 똑바로 달리고,
  // 게이트 둘레 25 m의 코스 선은 건너뛰어 잇고, 이은 곳의 모서리는 둥글게 편다.
  const intoStart: XY[] = [alongBearing(start, sb, -COURSE_SIM.leadInM), alongBearing(start, sb, -G), start, alongBearing(start, sb, G)];
  let path: XY[];
  if (course.kind === 'loop') {
    // 한 바퀴 돌아 출발선을 다시 똑바로 지나고, 코스를 따라 조금 더 간다
    const lap = trimAround(trimAround(pts, start, skip, false), start, skip, true);
    const after = trimAround(pts, start, skip, false);
    const more: XY[] = [];
    let d = 0;
    for (let i = 0; i < after.length && d < COURSE_SIM.leadOutM; i++) {
      if (i > 0) d += dist(after[i]!, after[i - 1]!);
      more.push(after[i]!);
    }
    path = [...intoStart, ...lap, alongBearing(start, sb, -G), start, alongBearing(start, sb, G), ...more];
  } else {
    // 도착선도 도착선 방향으로 똑바로 지나 40 m 더 간다
    const middle = trimAround(trimAround(pts, start, skip, false), end, skip, true);
    path = [...intoStart, ...middle, alongBearing(end, fb, -G), end, alongBearing(end, fb, COURSE_SIM.leadOutM)];
  }
  const track = polylineTrack(smoothPath(path, COURSE_SIM.smoothM, 2));
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
