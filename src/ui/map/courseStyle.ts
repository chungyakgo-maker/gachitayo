// 코스 그리기 공통 (사용자 요청 시안 2): 사진 지도(Leaflet)와 선 지도(MapLibre)가 같이 쓴다. Leaflet·MapLibre를 가져오지 않는다.
// 코스 선은 밝은 하늘색 + 하얀 테두리(주행 지도와 같게), 출발·도착 핀은 하늘색으로 통일 + 영어 글자(START / FINISH, 사용자 요청), 출발선 하늘색 · 도착선 흰 점선,
// 구간 경계는 큰 노랑 점과 글자.

export const COURSE_STYLE = {
  /** 코스 선: 주행 지도와 같은 밝은 하늘색 + 하얀 테두리 (사용자 요청 "모든 지도에 적용". 빨강은 처음 기록할 때 지나온 길에만) */
  route: '#9fd0ff',
  routeOutline: '#ffffff',
  /** 출발·도착 핀과 출발선: 앱 포인트 하늘색으로 통일 (사용자 요청) */
  start: '#aacae6',
  finish: '#aacae6',
  /** 핀 가운데 점 (하늘색 위에서 잘 보이게 어둡게) */
  pinDot: '#0d1a26',
  sector: '#ffb224',
  outline: '#0b0c0e',
} as const;

export type GateWhich = 'start' | 'finish';

/** 핀 글자 (사용자 요청: 영어로) */
export const PIN_LABEL = { start: 'START', finish: 'FINISH' } as const;

/** 핀과 글자가 점 위로 이만큼(px) 올라가 있어, 화면 맞출 때 위쪽을 더 비운다 */
export const PIN_TOP_PX = 54;

/** 코스 편집 지도에 그리는 모양 ([위도, 경도]) */
export type MapShape =
  | { kind: 'line'; pts: Array<[number, number]>; color: string; weight: number; dash?: string; opacity?: number }
  | { kind: 'dot'; at: [number, number]; color: string; r: number }
  | { kind: 'label'; at: [number, number]; text: string }
  /** 코스 선 (밝은 하늘색 + 하얀 테두리) */
  | { kind: 'route'; pts: Array<[number, number]> }
  /** 출발선·도착선 */
  | { kind: 'gate'; a: [number, number]; b: [number, number]; which: GateWhich }
  /** 출발·도착 핀 + 글자 */
  | { kind: 'pin'; at: [number, number]; which: GateWhich; text: string }
  /** 구간 경계 점 + 글자 */
  | { kind: 'sector'; at: [number, number]; text: string };

export interface PickMapController {
  /** fit: 이 점들이 다 보이게 (없으면 그대로) */
  setShapes(shapes: MapShape[], fit?: Array<[number, number]>): void;
  center(at: [number, number], zoom: number): void;
  setOnline(online: boolean): void;
  destroy(): void;
}

const PIN_SVG = (color: string) =>
  `<svg width="26" height="36" viewBox="0 0 26 36" aria-hidden="true"><path d="M13 35C13 35 2 21.5 2 13A11 11 0 1 1 24 13C24 21.5 13 35 13 35Z" fill="${color}" stroke="#ffffff" stroke-width="2.2"/><circle cx="13" cy="13" r="4.6" fill="${COURSE_STYLE.pinDot}"/></svg>`;

/** 출발·도착 하늘색 핀 + 위에 글자 START / FINISH (26×36, 끝이 아래 가운데) */
export function pinElement(which: GateWhich, text: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = PIN_SVG(which === 'start' ? COURSE_STYLE.start : COURSE_STYLE.finish);
  const label = document.createElement('span');
  label.className = 'map-label big pin-label';
  label.textContent = text;
  el.appendChild(label);
  return el;
}

/** 구간 경계 글자 (점 위) */
export function sectorLabelElement(text: string): HTMLElement {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}
