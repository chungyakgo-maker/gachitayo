// 지도 종류(사진 지도 Leaflet / 선 지도 MapLibre)와 상관없이 화면이 쓰는 지도 모양. 지도 라이브러리를 가져오지 않는다.

export interface MapFix {
  lat: number;
  lon: number;
  hAcc: number;
}

export interface FriendMarker {
  userId: string;
  nickname: string;
  lat: number;
  lon: number;
  /** 몇 ms 전 위치인지 (30초가 넘으면 흐리게) */
  ageMs: number;
}

/** 메인 지도 (사양서 8.2) */
export interface MainMapApi {
  update(course: import('../../types/course').Course | null, me: MapFix | null): void;
  setOnline(online: boolean): void;
  /** GPS 아이콘: 내 위치로 옮기고 다시 따라간다 */
  locate(me: MapFix): void;
  /** 위치 공유 중인 친구 (점과 닉네임) */
  setFriends(list: FriendMarker[]): void;
  /** 다른 저장된 코스들 (가는 빨간 선 + 이름, 즐겨찾기(코스 id)는 진한 보라로 굵게). update의 코스는 빼고 그린다 (사용자 요청: 메인 지도에 코스 다 보이게) */
  setCourses(list: import('../../types/course').Course[], favorites?: ReadonlySet<string>): void;
  /** 코스 선을 누르면 그 코스 id (코스 둘러보기: 출발점 안내 창). null이면 끈다 */
  onCourseTap(cb: ((courseId: string) => void) | null): void;
  /** 코스(감지된 코스 + 다른 코스) 보이기·숨기기. 지도 위치는 그대로 (사용자 요청: 코스 보기 칩) */
  setShowCourses(on: boolean): void;
  /** 친구들(과 나)이 다 보이게 */
  fitFriends(me: MapFix | null): void;
  /** 지도 위에 얹은 칸이 가리는 높이 (px). 내 위치·맞추기는 가려지지 않은 영역 기준 (사용자 요청) */
  setInsets(top: number, bottom: number): void;
  /** 목적지 경로 선(하늘색)과 목적지 핀 (목적지 고르기). 경로가 바뀌면 경로에 맞춰 화면을 옮기고 내 위치 따라가기를 멈춘다. null이면 지운다 */
  setRoute(points: ReadonlyArray<readonly [number, number]> | null, dest: { lat: number; lon: number } | null): void;
  /** 길게 눌러 고르기 (목적지 고르기). null이면 끈다 */
  onLongPress(cb: ((lat: number, lon: number) => void) | null): void;
  /** 지도 상태 알림 (2026-11-18 "메인·주행 똑같이"): away = 내 위치를 따라가지 않음(손으로 옮김·친구·경로 보기) → GPS 버튼이 "내 위치로",
   *  bearing = 지도 위쪽 방위(°, 돌렸으면 나침반). null이면 끈다 */
  onView?(cb: ((v: { away: boolean; bearing: number }) => void) | null): void;
  /** 돌린 지도를 북쪽 위로 */
  resetNorth?(): void;
  destroy(): void;
}

/** 주행·재생 지도의 바탕 (코스·고스트·내 위치는 그 위 캔버스에 그린다) */
export interface ReplayMapController {
  /** 점들이 가려지지 않은 영역을 꽉 채우게 */
  fit(points: Array<[number, number]>, inset: { top: number; bottom: number }): void;
  /** 내 위치를 가려지지 않은 영역의 가운데에, 가깝게 */
  follow(lat: number, lon: number, inset: { top: number; bottom: number }): void;
  /** 지도 한가운데에 놓기 (진행 방향 위 보기: 지도판을 크게 만들어 돌리므로 가운데 = 나) */
  centerOn(lat: number, lon: number): void;
  /** 매 프레임 따라가기 (사용자 요청 "지도가 뚝뚝 끊긴다") */
  track(lat: number, lon: number, inset: { top: number; bottom: number }): void;
  /** 지도 상자 크기가 바뀌었을 때 */
  resize(): void;
  /** 위경도 → 지도 안의 화면 좌표 (px) */
  project(lat: number, lon: number): { x: number; y: number };
  setOnline(online: boolean): void;
  destroy(): void;
  /** 지도가 스스로 돌 수 있으면 (선 지도): 지도판을 CSS로 돌리지 않고 trackHeading을 쓴다. 지명이 거꾸로 서지 않는다 */
  readonly nativeRotate?: boolean;
  /** 진행 방향 위: 내 위치를 가려지지 않은 영역 가운데에, 진행 방향(나침반 °)이 위로 */
  trackHeading?(lat: number, lon: number, bearingDeg: number, inset: { top: number; bottom: number }): void;
  /** 주행 지도 + / − (사용자 요청): 따라가기 확대 단계를 이만큼 더하고, 전체 보기는 맞춘 뒤 이만큼 */
  setZoomOffset?(d: number): void;
  /** 손 동작을 지도가 직접 받을 때 (선 지도, 2026-11-18 "메인·주행 똑같이"): 손가락이 닿음 · 지도가 손으로 움직이기 시작함 · 손을 다 뗌(관성 끝). null 이면 끈다 */
  onUser?(cb: ((phase: 'down' | 'moved' | 'up') => void) | null): void;
  /** 지금 카메라: 가운데(위·아래 가림을 뺀 자리)·확대 단계(따라가기 기준 +/−)·방위 */
  camera?(): { lat: number; lon: number; zoomOffset: number; bearing: number };
  /** 둘러보는 중의 + / − : 지도가 스르륵 (저장 안 함) */
  zoomBy?(d: number): void;
}

/** 따라가기 확대 단계 (사진 지도 기준. 선 지도는 1 작은 값이 같은 넓이) */
export const FOLLOW_ZOOM = 17;

export interface AnalysisLapLine {
  pts: Array<[number, number]>;
  /** 점마다 색 (속도 색칠). 없으면 colorAll */
  colors?: string[];
  colorAll?: string;
}

export interface AnalysisMapController {
  setLines(a: AnalysisLapLine | null, b: AnalysisLapLine | null, fit: boolean): void;
  setMarker(at: [number, number] | null): void;
  setOnline(online: boolean): void;
  destroy(): void;
}
