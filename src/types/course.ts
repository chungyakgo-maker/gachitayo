// 코스 (사양서 6.5 courses). 저장 형식은 위경도, 계산은 코스 원점 기준 평면 좌표(engine/course/geometry).
import type { LatLon } from '../engine/geo';

export interface Gate {
  lat: number;
  lon: number;
  /** 진행 방향 (나침반: 북 0°, 시계 방향) */
  bearingDeg: number;
  widthM: number;
}

export type CourseKind = 'loop' | 'point_to_point';
export type CourseSource = 'auto' | 'map' | 'gpx';

export interface Course {
  id: string;
  name: string;
  kind: CourseKind;
  source: CourseSource;
  /** 지역 좌표 원점 */
  origin: LatLon;
  startGate: Gate;
  /** 랩 코스는 startGate와 같다 */
  finishGate: Gate;
  /** [[lat, lon], …] 1 m 간격. 지도로 등록하고 첫 주행 전이면 null */
  centerline: Array<[number, number]> | null;
  lengthM: number | null;
  sectorBoundsM: [number, number] | null;
  /** 중심선·게이트가 바뀔 때마다 +1 */
  version: number;
}
