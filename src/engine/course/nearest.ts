// 현재 위치에서 가까운 코스 (사양서 8.2, 8.3: 현재 위치로 자동 감지)
import { toLocal } from '../geo';
import type { Course } from '../../types/course';
import { gateSegment } from './geometry';

/** 이보다 멀면 "근처에 코스 없음" */
const MAX_DISTANCE_M = 1000;
/** 가장 가까운 코스와 이 안으로 차이 나면 같은 길로 본다 (정방향·역방향 코스): 출발선이 가까운 쪽 */
const SAME_ROAD_M = 30;

/**
 * 코스마다 현재 위치에서 중심선(없으면 출발선)까지 거리를 재서 가장 가까운 코스.
 * 중심선은 저장된 위경도 점 사이 선분까지의 거리.
 */
export function nearestCourse(courses: Course[], lat: number, lon: number): { course: Course; distanceM: number } | null {
  const found: Array<{ course: Course; distanceM: number }> = [];
  for (const c of courses) {
    const p = toLocal(c.origin, lat, lon);
    let d = Infinity;
    if (c.centerline && c.centerline.length > 1) {
      let prev = toLocal(c.origin, c.centerline[0]![0], c.centerline[0]![1]);
      // 멀리 있는 코스는 점을 다 보지 않는다: 중심선의 모든 점은 첫 점에서 코스 길이 안에 있다 (삼각 부등식)
      if (c.lengthM !== null && Math.hypot(p.x - prev.x, p.y - prev.y) > MAX_DISTANCE_M + c.lengthM * 1.01 + 10) continue;
      for (let i = 1; i < c.centerline.length; i++) {
        const q = toLocal(c.origin, c.centerline[i]![0], c.centerline[i]![1]);
        d = Math.min(d, segDist(p.x, p.y, prev.x, prev.y, q.x, q.y));
        prev = q;
      }
    } else {
      const g = gateSegment(c.startGate, c.origin);
      d = Math.hypot(p.x - g.cx, p.y - g.cy);
    }
    if (d <= MAX_DISTANCE_M) found.push({ course: c, distanceM: d });
  }
  if (found.length === 0) return null;
  const min = Math.min(...found.map((f) => f.distanceM));
  // 같은 길에 코스가 여럿이면(정방향·역방향, 사용자 신고 "출근 역방향으로 탔는데 인식 안 됨") 출발선이 가까운 쪽.
  // 목록 순서로 고르면 반대 방향 코스가 잡혀 출발선·도착선을 반대로 지나 랩이 안 잡힌다
  const toStart = (c: Course) => {
    const p = toLocal(c.origin, lat, lon);
    const g = gateSegment(c.startGate, c.origin);
    return Math.hypot(p.x - g.cx, p.y - g.cy);
  };
  return found.filter((f) => f.distanceM <= min + SAME_ROAD_M).reduce((a, b) => (toStart(b.course) < toStart(a.course) ? b : a));
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const f = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + f * dx), py - (ay + f * dy));
}
