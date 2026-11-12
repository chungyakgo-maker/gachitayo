// 메인 지도의 Leaflet 부분 (사양서 8.2): 통신이 되면 OpenStreetMap 타일, 안 되면 타일 없이(바탕 격자).
// 코스 선, 출발선(편도면 도착선), 내 위치(정확도 원 포함). 이 파일은 메인 화면이 처음 열릴 때 따로 불러온다.
// OSM 타일 이용 정책: 출처 표시, 타일을 미리 받아 두지 않음(서비스 워커도 쌓지 않음), 최대 확대 19.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { gateSegment } from '../../engine/course/geometry';
import { fromLocal } from '../../engine/geo';
import type { Course } from '../../types/course';

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
// ── 코스 그리기 (사용자 요청 시안 2): 빨간 선 + 빛 번짐, 출발 파랑 핀·도착 빨강 핀 + 큰 글자,
//    출발선 파랑 · 도착선 흰 점선, 구간 경계는 큰 노랑 점과 글자. 코스 상세·메인·새 코스 지도가 같이 쓴다 (주행 지도는 따로) ──

export const COURSE_STYLE = {
  glow: '#ff3b30',
  route: '#ff453a',
  highlight: '#ffd2ce',
  start: '#2f7bff',
  finish: '#ff3b30',
  sector: '#ffb224',
  outline: '#0b0c0e',
} as const;

export type GateWhich = 'start' | 'finish';

/** 빨간 코스 선: 넓고 옅은 두 줄(빛 번짐) + 진한 선 + 가운데 밝은 줄 */
export function addRoute(layer: L.LayerGroup, pts: L.LatLngExpression[]): void {
  const o = { lineJoin: 'round', lineCap: 'round', interactive: false } as const;
  L.polyline(pts, { ...o, color: COURSE_STYLE.glow, opacity: 0.16, weight: 18, className: 'course-glow' }).addTo(layer);
  L.polyline(pts, { ...o, color: COURSE_STYLE.glow, opacity: 0.3, weight: 10, className: 'course-glow' }).addTo(layer);
  L.polyline(pts, { ...o, color: COURSE_STYLE.route, opacity: 1, weight: 4, className: 'course-line' }).addTo(layer);
  L.polyline(pts, { ...o, color: COURSE_STYLE.highlight, opacity: 0.9, weight: 1.2 }).addTo(layer);
}

/** 출발선(파랑)·도착선(흰 점선), 검은 테두리 */
export function addGateLine(layer: L.LayerGroup, a: L.LatLngExpression, b: L.LatLngExpression, which: GateWhich): void {
  L.polyline([a, b], { color: COURSE_STYLE.outline, weight: 6.5, lineCap: 'round', interactive: false }).addTo(layer);
  L.polyline([a, b], { color: which === 'start' ? COURSE_STYLE.start : '#ffffff', weight: 3.5, lineCap: 'round', dashArray: which === 'finish' ? '4 3' : undefined, interactive: false }).addTo(layer);
}

const PIN_SVG = (color: string) =>
  `<svg width="26" height="36" viewBox="0 0 26 36" aria-hidden="true"><path d="M13 35C13 35 2 21.5 2 13A11 11 0 1 1 24 13C24 21.5 13 35 13 35Z" fill="${color}" stroke="#ffffff" stroke-width="2.2"/><circle cx="13" cy="13" r="4.6" fill="#ffffff"/></svg>`;

/** 출발 파랑 핀 · 도착 빨강 핀. 끝이 그 점을 가리키고, 위에 큰 글자 */
export function addPin(layer: L.LayerGroup, at: L.LatLngExpression, which: GateWhich, text: string): void {
  const el = document.createElement('div');
  el.innerHTML = PIN_SVG(which === 'start' ? COURSE_STYLE.start : COURSE_STYLE.finish);
  const label = document.createElement('span');
  label.className = 'map-label big pin-label';
  label.textContent = text;
  el.appendChild(label);
  L.marker(at, { icon: L.divIcon({ className: `map-pin ${which}`, html: el, iconSize: [26, 36], iconAnchor: [13, 36] }), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(layer);
}

/** 구간 경계: 큰 노랑 점 + 그 위 노랑 글자 */
export function addSector(layer: L.LayerGroup, at: L.LatLngExpression, text: string): void {
  L.circleMarker(at, { radius: 7, color: COURSE_STYLE.outline, weight: 2.5, fillColor: COURSE_STYLE.sector, fillOpacity: 1, interactive: false }).addTo(layer);
  const span = document.createElement('span');
  span.textContent = text;
  L.marker(at, { icon: L.divIcon({ className: 'map-label big map-sector', html: span, iconSize: [60, 20], iconAnchor: [30, 32] }), interactive: false, keyboard: false }).addTo(layer);
}

/** 핀과 글자가 점 위로 이만큼(px) 올라가 있어, 화면 맞출 때 위쪽을 더 비운다 */
export const PIN_TOP_PX = 60;

/** 타일이 이만큼 연달아 실패하면 통신이 안 되는 것으로 보고 타일 없이 그린다 */
const TILE_FAILS_OFFLINE = 6;

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

export interface MainMapController {
  update(course: Course | null, me: MapFix | null): void;
  setOnline(online: boolean): void;
  /** "내 위치" 버튼: 내 위치로 옮기고 다시 따라간다 */
  locate(me: MapFix): void;
  /** 위치 공유 중인 친구 (점과 닉네임) */
  setFriends(list: FriendMarker[]): void;
  /** 친구들(과 나)이 다 보이게 */
  fitFriends(me: MapFix | null): void;
  /** 지도 위에 얹은 칸이 가리는 높이 (px). 내 위치·맞추기는 가려지지 않은 영역 기준 (사용자 요청) */
  setInsets(top: number, bottom: number): void;
  /** 타일을 보여주는 중인지 (시험용) */
  tilesShown(): boolean;
  /** Leaflet 지도 (시험용) */
  readonly map: L.Map;
  destroy(): void;
}

const ACCENT = '#aacae6';
const FRIEND = '#b78cff';

export function createMainMap(el: HTMLElement, onTiles?: (shown: boolean) => void): MainMapController {
  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.25, fadeAnimation: false });
  map.attributionControl.setPrefix(false);
  const tiles = L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION, className: 'osm-tiles' });
  const courseLayer = L.layerGroup().addTo(map);
  const friendLayer = L.layerGroup().addTo(map);
  const meLayer = L.layerGroup().addTo(map);
  let friends: FriendMarker[] = [];
  map.setView([36.5, 127.8], 7); // 처음엔 남한 전체 (위치·코스가 오면 바로 옮긴다)

  let shown = false;
  let fails = 0;
  tiles.on('tileload', () => {
    fails = 0;
  });
  tiles.on('tileerror', () => {
    fails++;
    if (fails >= TILE_FAILS_OFFLINE) showTiles(false);
  });
  function showTiles(on: boolean) {
    if (on === shown) return;
    shown = on;
    fails = 0;
    if (on) tiles.addTo(map);
    else tiles.remove();
    onTiles?.(on);
  }

  let courseKey: string | null = null;
  let lastCourse: Course | null = null;
  let lastMe: MapFix | null = null;
  let inset = { top: 0, bottom: 0 };
  /** 이 점이 가려지지 않은 영역의 가운데에 오게 하는 지도 중심 */
  const centerFor = (ll: L.LatLngExpression, zoom: number) => map.unproject(map.project(ll, zoom).add([0, (inset.bottom - inset.top) / 2]), zoom);
  const pad = (n: number) => ({ paddingTopLeft: L.point(n, n + inset.top), paddingBottomRight: L.point(n, n + inset.bottom) });
  let haveMe = false;
  let userMoved = false;
  let programmatic = false;
  map.on('dragstart', () => {
    if (!programmatic) userMoved = true;
  });
  map.on('zoomstart', () => {
    if (!programmatic) userMoved = true;
  });
  const move = (f: () => void) => {
    programmatic = true;
    try {
      f();
    } finally {
      programmatic = false;
    }
  };

  function drawCourse(course: Course | null) {
    courseLayer.clearLayers();
    if (!course) return;
    const line = (course.centerline ?? []).map(([lat, lon]) => L.latLng(lat, lon));
    if (line.length >= 2) addRoute(courseLayer, course.kind === 'loop' ? [...line, line[0]!] : line);
    const gate = (g: Course['startGate'], which: GateWhich, text: string) => {
      const s = gateSegment(g, course.origin);
      const a = fromLocal(course.origin, s.ax, s.ay);
      const b = fromLocal(course.origin, s.bx, s.by);
      addGateLine(courseLayer, [a.lat, a.lon], [b.lat, b.lon], which);
      addPin(courseLayer, [g.lat, g.lon], which, text);
    };
    gate(course.startGate, 'start', '출발');
    if (course.kind === 'point_to_point') gate(course.finishGate, 'finish', '도착');
  }

  function drawMe(me: MapFix | null) {
    meLayer.clearLayers();
    if (!me) return;
    const at = L.latLng(me.lat, me.lon);
    if (me.hAcc > 0) L.circle(at, { radius: me.hAcc, color: ACCENT, weight: 1, opacity: 0.35, fillColor: ACCENT, fillOpacity: 0.08, interactive: false }).addTo(meLayer);
    L.circleMarker(at, { radius: 16, stroke: false, fillColor: ACCENT, fillOpacity: 0.16, interactive: false }).addTo(meLayer);
    L.circleMarker(at, { radius: 6.5, color: ACCENT, weight: 3, fillColor: '#eceef0', fillOpacity: 1, interactive: false }).addTo(meLayer);
    L.marker(at, { icon: L.divIcon({ className: 'map-label me', html: '나', iconSize: [20, 16], iconAnchor: [10, 32] }), interactive: false, keyboard: false }).addTo(meLayer);
  }

  function fit(course: Course | null, me: MapFix | null) {
    const pts: L.LatLng[] = (course?.centerline ?? []).map(([lat, lon]) => L.latLng(lat, lon));
    if (course && pts.length === 0) pts.push(L.latLng(course.startGate.lat, course.startGate.lon));
    if (me) pts.push(L.latLng(me.lat, me.lon));
    if (pts.length === 0) return;
    move(() => {
      if (pts.length === 1 || !course) map.setView(centerFor(pts[pts.length - 1]!, 16), 16, { animate: false });
      else map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: L.point(44, 44 + inset.top + PIN_TOP_PX), paddingBottomRight: L.point(44, 44 + inset.bottom), maxZoom: 17, animate: false });
    });
  }

  return {
    update(course, me) {
      lastCourse = course;
      lastMe = me;
      const key = course ? `${course.id}:${course.version}` : null;
      const courseChanged = key !== courseKey;
      if (courseChanged) {
        courseKey = key;
        drawCourse(course);
      }
      drawMe(me);
      // 코스가 바뀌었거나 처음 위치를 받았을 때만 화면을 맞춘다 (사용자가 옮긴 뒤에는 위치가 바뀌어도 그대로)
      const firstFix = me !== null && !haveMe;
      haveMe = me !== null;
      if (courseChanged || (firstFix && !userMoved)) {
        if (courseChanged) userMoved = false;
        fit(course, me);
      } else if (me && !course && !userMoved) {
        // 코스가 없으면 내 위치를 따라간다 (사용자가 지도를 옮기면 멈추고, "내 위치"를 누르면 다시)
        move(() => map.panTo(centerFor([me.lat, me.lon], map.getZoom()), { animate: false }));
      }
    },
    setOnline(online) {
      showTiles(online);
    },
    setFriends(list) {
      friends = list;
      friendLayer.clearLayers();
      for (const f of list) {
        const stale = f.ageMs > 30_000;
        const at = L.latLng(f.lat, f.lon);
        L.circleMarker(at, { radius: 7, color: '#0d0e10', weight: 2, fillColor: FRIEND, fillOpacity: stale ? 0.45 : 1, opacity: stale ? 0.45 : 1, interactive: false }).addTo(friendLayer);
        const label = document.createElement('span');
        label.textContent = f.nickname; // 닉네임은 글자로만 (HTML로 해석하지 않는다)
        L.marker(at, { icon: L.divIcon({ className: `map-label friend${stale ? ' stale' : ''}`, html: label, iconSize: [120, 16], iconAnchor: [60, 26] }), interactive: false, keyboard: false }).addTo(friendLayer);
      }
    },
    fitFriends(me) {
      const pts = friends.map((f) => L.latLng(f.lat, f.lon));
      if (me) pts.push(L.latLng(me.lat, me.lon));
      if (pts.length === 0) return;
      userMoved = true; // 친구를 보는 동안은 내 위치를 따라가지 않는다 ("내 위치"를 누르면 다시)
      move(() => {
        if (pts.length === 1) map.setView(centerFor(pts[0]!, 16), 16, { animate: false });
        else map.fitBounds(L.latLngBounds(pts), { ...pad(56), maxZoom: 16, animate: false });
      });
    },
    locate(me) {
      userMoved = false;
      const z = Math.max(map.getZoom(), 16);
      move(() => map.setView(centerFor([me.lat, me.lon], z), z, { animate: false }));
    },
    setInsets(top, bottom) {
      if (top === inset.top && bottom === inset.bottom) return;
      inset = { top, bottom };
      map.invalidateSize({ pan: false });
      // 사용자가 지도를 옮기지 않았으면 새 영역에 맞춰 다시
      if (!userMoved && (lastCourse || lastMe)) fit(lastCourse, lastMe);
    },
    tilesShown: () => shown,
    map,
    destroy() {
      map.remove();
    },
  };
}

// ── 재생 모드 지도 (사용자 요청: 재생할 때는 지도 위에, 전체 코스 / 따라가기) ──
// 운전 중이 아니라서 타일을 쓴다 (주행 중 지도 모드는 사양서 8.4대로 타일 없이). 지도는 바탕만 그리고,
// 코스·고스트·내 위치는 오버레이 그리기 함수(캔버스)가 이 지도의 좌표 변환으로 그 위에 그린다.

export interface ReplayMapController {
  /** 점들이 가려지지 않은 영역을 꽉 채우게 */
  fit(points: Array<[number, number]>, inset: { top: number; bottom: number }): void;
  /** 내 위치를 가려지지 않은 영역의 가운데에, 가깝게 */
  follow(lat: number, lon: number, inset: { top: number; bottom: number }): void;
  /** 지도 한가운데에 놓기 (진행 방향 위 보기: 지도판을 크게 만들어 돌리므로 가운데 = 나) */
  centerOn(lat: number, lon: number): void;
  /**
   * 매 프레임 따라가기 (사용자 요청 "지도가 뚝뚝 끊긴다"): 다시 맞추지 않고 지도판을 그만큼만 밀어 가볍다.
   * 확대 단계가 다르거나 크게 떨어지면 한 번 맞춘다
   */
  track(lat: number, lon: number, inset: { top: number; bottom: number }): void;
  /** 지도 상자 크기가 바뀌었을 때 */
  resize(): void;
  /** 위경도 → 지도 안의 화면 좌표 (px) */
  project(lat: number, lon: number): { x: number; y: number };
  setOnline(online: boolean): void;
  destroy(): void;
}

export const FOLLOW_ZOOM = 17;

export function createReplayMap(el: HTMLElement): ReplayMapController {
  // 재생 화면은 두 번 탭으로 모드를 바꾸므로 지도 조작은 모두 끈다.
  // 지도 출처는 지도판이 돌아가도 바로 보이게 바깥(LiveMap)에서 글자로 쓴다
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: false,
    zoomSnap: 0,
    fadeAnimation: false,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
  });
  const tiles = L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION, className: 'osm-tiles' });
  map.setView([36.5, 127.8], 7);
  let shown = false;
  let fails = 0;
  tiles.on('tileload', () => {
    fails = 0;
  });
  tiles.on('tileerror', () => {
    if (++fails >= TILE_FAILS_OFFLINE) setTiles(false);
  });
  function setTiles(on: boolean) {
    if (on === shown) return;
    shown = on;
    fails = 0;
    if (on) tiles.addTo(map);
    else tiles.remove();
  }
  return {
    fit(points, inset) {
      if (points.length === 0) return;
      map.invalidateSize({ pan: false });
      if (points.length === 1) map.setView(map.unproject(map.project(points[0]!, FOLLOW_ZOOM).add([0, (inset.bottom - inset.top) / 2]), FOLLOW_ZOOM), FOLLOW_ZOOM, { animate: false });
      else map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [20, 20 + inset.top], paddingBottomRight: [20, 20 + inset.bottom], maxZoom: 18, animate: false });
    },
    follow(lat, lon, inset) {
      map.invalidateSize({ pan: false });
      // 가려지지 않은 영역의 가운데에 오게 (위·아래 가림 차이의 절반만큼 옮긴다)
      const c = map.project([lat, lon], FOLLOW_ZOOM).add([0, (inset.bottom - inset.top) / 2]);
      map.setView(map.unproject(c, FOLLOW_ZOOM), FOLLOW_ZOOM, { animate: false });
    },
    centerOn(lat, lon) {
      map.invalidateSize({ pan: false });
      map.setView([lat, lon], FOLLOW_ZOOM, { animate: false });
    },
    track(lat, lon, inset) {
      const target = map.unproject(map.project([lat, lon], FOLLOW_ZOOM).add([0, (inset.bottom - inset.top) / 2]), FOLLOW_ZOOM);
      if (map.getZoom() !== FOLLOW_ZOOM) {
        map.setView(target, FOLLOW_ZOOM, { animate: false });
        return;
      }
      const off = map.project(target, FOLLOW_ZOOM).subtract(map.project(map.getCenter(), FOLLOW_ZOOM));
      if (Math.abs(off.x) < 0.5 && Math.abs(off.y) < 0.5) return;
      if (Math.hypot(off.x, off.y) > 300) map.setView(target, FOLLOW_ZOOM, { animate: false });
      else map.panBy(off, { animate: false });
    },
    resize() {
      map.invalidateSize({ pan: false });
    },
    project(lat, lon) {
      const p = map.latLngToContainerPoint([lat, lon]);
      return { x: p.x, y: p.y };
    },
    setOnline(online) {
      setTiles(online);
    },
    destroy() {
      map.remove();
    },
  };
}

// ── 분석 지도 (사양서 8.6): 랩 A는 속도로 색칠, 랩 B는 가는 회색 선, 고른 지점 표시. 누르면 그 위치를 알려 준다 ──

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

export function createAnalysisMap(el: HTMLElement, onPick: (lat: number, lon: number) => void): AnalysisMapController {
  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.25, fadeAnimation: false, doubleClickZoom: false });
  map.attributionControl.setPrefix(false);
  const tiles = L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION, className: 'osm-tiles' });
  const lineLayer = L.layerGroup().addTo(map);
  const markLayer = L.layerGroup().addTo(map);
  map.setView([36.5, 127.8], 7);
  let shown = false;
  let fails = 0;
  tiles.on('tileload', () => {
    fails = 0;
  });
  tiles.on('tileerror', () => {
    if (++fails >= TILE_FAILS_OFFLINE) setTiles(false);
  });
  function setTiles(on: boolean) {
    if (on === shown) return;
    shown = on;
    fails = 0;
    if (on) tiles.addTo(map);
    else tiles.remove();
  }
  map.on('click', (e: L.LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng));
  return {
    setLines(a, b, fit) {
      lineLayer.clearLayers();
      if (b && b.pts.length >= 2) L.polyline(b.pts, { color: b.colorAll ?? '#9aa1a9', weight: 3, opacity: 0.8, dashArray: '6 5', interactive: false }).addTo(lineLayer);
      if (a && a.pts.length >= 2) {
        if (a.colors) {
          // 이웃한 두 점마다 한 조각, 그 속도 색으로
          for (let i = 1; i < a.pts.length; i++) L.polyline([a.pts[i - 1]!, a.pts[i]!], { color: a.colors[i]!, weight: 5, opacity: 0.95, interactive: false }).addTo(lineLayer);
        } else L.polyline(a.pts, { color: a.colorAll ?? ACCENT, weight: 5, interactive: false }).addTo(lineLayer);
      }
      if (fit) {
        const all = [...(a?.pts ?? []), ...(b?.pts ?? [])];
        map.invalidateSize({ pan: false });
        if (all.length >= 2) map.fitBounds(L.latLngBounds(all), { padding: [24, 24], animate: false });
      }
    },
    setMarker(at) {
      markLayer.clearLayers();
      if (!at) return;
      L.circleMarker(at, { radius: 14, stroke: false, fillColor: ACCENT, fillOpacity: 0.25, interactive: false }).addTo(markLayer);
      L.circleMarker(at, { radius: 6, color: '#0d0e10', weight: 2, fillColor: '#eceef0', fillOpacity: 1, interactive: false }).addTo(markLayer);
    },
    setOnline(online) {
      setTiles(online);
    },
    destroy() {
      map.remove();
    },
  };
}

// ── 코스 편집 지도 (사양서 8.7): 선·점·글자를 그리고, 누른 곳을 알려 준다 ──

export type MapShape =
  | { kind: 'line'; pts: Array<[number, number]>; color: string; weight: number; dash?: string; opacity?: number }
  | { kind: 'dot'; at: [number, number]; color: string; r: number }
  | { kind: 'label'; at: [number, number]; text: string }
  /** 코스 선 (빨간 선 + 빛 번짐) */
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

export function createPickMap(el: HTMLElement, onPick: (lat: number, lon: number) => void): PickMapController {
  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.25, fadeAnimation: false, doubleClickZoom: false });
  map.attributionControl.setPrefix(false);
  const tiles = L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION, className: 'osm-tiles' });
  const layer = L.layerGroup().addTo(map);
  map.setView([36.5, 127.8], 7);
  let shown = false;
  let fails = 0;
  tiles.on('tileload', () => {
    fails = 0;
  });
  tiles.on('tileerror', () => {
    if (++fails >= TILE_FAILS_OFFLINE) setTiles(false);
  });
  function setTiles(on: boolean) {
    if (on === shown) return;
    shown = on;
    fails = 0;
    if (on) tiles.addTo(map);
    else tiles.remove();
  }
  map.on('click', (e: L.LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng));
  return {
    setShapes(shapes, fit) {
      layer.clearLayers();
      for (const s of shapes) {
        if (s.kind === 'line') L.polyline(s.pts, { color: s.color, weight: s.weight, dashArray: s.dash, opacity: s.opacity ?? 1, lineCap: 'round', interactive: false }).addTo(layer);
        else if (s.kind === 'route') addRoute(layer, s.pts);
        else if (s.kind === 'gate') addGateLine(layer, s.a, s.b, s.which);
        else if (s.kind === 'pin') addPin(layer, s.at, s.which, s.text);
        else if (s.kind === 'sector') addSector(layer, s.at, s.text);
        else if (s.kind === 'dot') L.circleMarker(s.at, { radius: s.r, color: '#0d0e10', weight: 2, fillColor: s.color, fillOpacity: 1, interactive: false }).addTo(layer);
        else {
          const span = document.createElement('span');
          span.textContent = s.text;
          L.marker(s.at, { icon: L.divIcon({ className: 'map-label', html: span, iconSize: [60, 16], iconAnchor: [30, 22] }), interactive: false, keyboard: false }).addTo(layer);
        }
      }
      if (fit && fit.length) {
        map.invalidateSize({ pan: false });
        if (fit.length === 1) map.setView(fit[0]!, 17, { animate: false });
        else map.fitBounds(L.latLngBounds(fit), { paddingTopLeft: [32, 32 + PIN_TOP_PX], paddingBottomRight: [32, 32], maxZoom: 18, animate: false });
      }
    },
    center(at, zoom) {
      map.setView(at, zoom, { animate: false });
    },
    setOnline(online) {
      setTiles(online);
    },
    destroy() {
      map.remove();
    },
  };
}
