// 코스의 계산 형식: 위경도 저장 형식(Course)을 코스 원점 기준 평면 좌표로 바꾼다.
import { config } from '../config';
import { fromLocal, toLocal, type LatLon } from '../geo';
import type { Course, Gate } from '../../types/course';
import { makePolyline, type Polyline } from './polyline';

export interface GateSegment {
  /** 가운데 */
  cx: number;
  cy: number;
  /** 진행 방향 단위벡터 */
  dx: number;
  dy: number;
  /** 게이트 선분 양 끝 */
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface CourseGeometry {
  course: Course;
  /** 첫 주행 전(지도 등록)이면 null */
  centerline: Polyline | null;
  start: GateSegment;
  finish: GateSegment;
  sectorBounds: [number, number] | null;
}

const DEG = Math.PI / 180;

export function gateSegment(gate: Gate, origin: LatLon): GateSegment {
  const c = toLocal(origin, gate.lat, gate.lon);
  const dx = Math.sin(gate.bearingDeg * DEG);
  const dy = Math.cos(gate.bearingDeg * DEG);
  // 진행 방향에 수직 (왼쪽)
  const nx = -dy;
  const ny = dx;
  const h = gate.widthM / 2;
  return { cx: c.x, cy: c.y, dx, dy, ax: c.x - nx * h, ay: c.y - ny * h, bx: c.x + nx * h, by: c.y + ny * h };
}

/** 평면 좌표의 점과 진행 방향 ψ로 게이트를 만든다 */
export function gateFromPoint(
  x: number,
  y: number,
  psi: number,
  origin: LatLon,
  widthM: number = config.course.gateWidthM,
): Gate {
  const ll = fromLocal(origin, x, y);
  return { lat: ll.lat, lon: ll.lon, bearingDeg: (((90 - psi / DEG) % 360) + 360) % 360, widthM };
}

export function buildGeometry(course: Course): CourseGeometry {
  let centerline: Polyline | null = null;
  if (course.centerline && course.centerline.length >= 2) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [lat, lon] of course.centerline) {
      const p = toLocal(course.origin, lat, lon);
      xs.push(p.x);
      ys.push(p.y);
    }
    centerline = makePolyline(xs, ys);
  }
  return {
    course,
    centerline,
    start: gateSegment(course.startGate, course.origin),
    finish: gateSegment(course.finishGate, course.origin),
    sectorBounds: centerline ? sectorBounds(centerline.length) : null,
  };
}

export function sectorBounds(length: number): [number, number] {
  const [a, b] = config.course.sectorFractions;
  return [length * a, length * b];
}

/** 평면 중심선 → 저장 형식 [[lat, lon], …] (소수 7자리) */
export function centerlineToLatLon(p: Polyline, origin: LatLon): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
  for (let i = 0; i < p.x.length; i++) {
    const ll = fromLocal(origin, p.x[i]!, p.y[i]!);
    out.push([r7(ll.lat), r7(ll.lon)]);
  }
  return out;
}
