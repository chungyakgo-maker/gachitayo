import { describe, expect, it } from 'vitest';
import { makePolyline, polylinePoint, type Polyline } from '../../../src/engine/course/polyline';
import { straightEnds } from '../../../src/engine/course/edit';
import { BUILTIN_COURSES, builtinCourse } from '../../../src/courses/builtin';
import { BUILTIN_POINTS } from '../../../src/courses/builtinData';
import { buildGeometry } from '../../../src/engine/course/geometry';

/** 꺾은선 → 1 m 간격 점 */
function line(pts: Array<[number, number]>): Polyline {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[i + 1]!;
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay)));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      xs.push(ax + ((bx - ax) * k) / n);
      ys.push(ay + ((by - ay) * k) / n);
    }
  }
  return makePolyline(xs, ys);
}

const DEG = Math.PI / 180;
/** 방위(북 0°, 시계 방향) */
const bearingOf = (psi: number) => (((90 - psi / DEG) % 360) + 360) % 360;
const diff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
/** 코스 선 위 a→b 현의 방위 */
function chordBearing(cl: Polyline, a: number, b: number): number {
  const p = polylinePoint(cl, a);
  const q = polylinePoint(cl, b);
  return bearingOf(Math.atan2(q.y - p.y, q.x - p.x));
}

describe('경로 양 끝 진입로 건너뛰기 (사용자 요청 "북악 출발선 고쳐", 카카오맵 경로)', () => {
  it('출발 표시에서 도로까지 동쪽 8 m, 도로는 북쪽 400 m, 끝에서 서쪽 10 m → 진입로 다음부터', () => {
    const cl = line([[0, 0], [8, 0], [8, 400], [-2, 400]]);
    const { s0, s1 } = straightEnds(cl);
    expect(s0).toBeGreaterThanOrEqual(6);
    expect(s0).toBeLessThanOrEqual(14);
    expect(cl.length - s1).toBeGreaterThanOrEqual(8);
    expect(cl.length - s1).toBeLessThanOrEqual(16);
  });

  it('곧은 길은 그대로, 짧은 코스도 그대로', () => {
    const cl = line([[0, 0], [0, 500]]);
    expect(straightEnds(cl)).toEqual({ s0: 0, s1: cl.length });
    const short = line([[0, 0], [8, 0], [8, 100]]);
    expect(straightEnds(short)).toEqual({ s0: 0, s1: short.length });
  });

  it('기본 코스 11개: 출발·도착선이 도로 방향을 향하고(안쪽 5~35 m 방향과 20° 안), 선 앞뒤 20 m가 곧다', () => {
    const bad: string[] = [];
    for (const b of BUILTIN_COURSES) {
      const c = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: b.key, gateWidthM: 30 });
      const cl = buildGeometry(c).centerline!;
      const L = cl.length;
      const ds = diff(c.startGate.bearingDeg, chordBearing(cl, 5, 35));
      const df = diff(c.finishGate.bearingDeg, chordBearing(cl, L - 35, L - 5));
      let bendS = 0;
      let bendF = 0;
      for (let t = 0; t < 20; t++) {
        bendS = Math.max(bendS, diff(c.startGate.bearingDeg, bearingOf(polylinePoint(cl, t + 0.5).psi)));
        bendF = Math.max(bendF, diff(c.finishGate.bearingDeg, bearingOf(polylinePoint(cl, L - t - 0.5).psi)));
      }
      if (ds > 20 || df > 20 || bendS > 20 || bendF > 20) bad.push(`${b.name} 출발 ${ds.toFixed(0)}°/${bendS.toFixed(0)}° 도착 ${df.toFixed(0)}°/${bendF.toFixed(0)}°`);
    }
    expect(bad).toEqual([]);
  });

  it('북악스카이웨이 출발선: 도로(북동쪽)를 향한다 (예전 297°, 도로와 거의 나란한 선)', () => {
    const b = BUILTIN_COURSES.find((x) => x.key === 'bukak-skyway')!;
    const c = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: b.key, gateWidthM: 30 });
    expect(c.startGate.bearingDeg).toBeGreaterThan(45);
    expect(c.startGate.bearingDeg).toBeLessThan(85);
  });
});
