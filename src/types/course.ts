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
/** shared: 모두의 코스에서 받은 코스 · team: 팀 방에서 방장이 정해 받은 코스 (설계 3부) */
export type CourseSource = 'auto' | 'map' | 'gpx' | 'shared' | 'team';

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
  /** 기본 코스 키 (앱에 들어 있는 코스, courses/builtin). 폰에만 두고 서버 행에는 없다 */
  builtin?: string;
  /** 모두의 코스에서 받은 코스: 공개 번호와 올린 사람 닉네임 (설계 2부) */
  shared?: { id: string; by: string };
  /** 내가 모두의 코스로 공개한 코스: 공개 번호 */
  publishedId?: string;
  /** 공개할 때의 버전 (선을 고치면 "공개 코스도 바꾸기"를 켠다) */
  publishedVersion?: number;
  /** 공개할 때의 이름 */
  publishedName?: string;
}
