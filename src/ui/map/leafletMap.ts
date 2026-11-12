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
  /** 타일을 보여주는 중인지 (시험용) */
  tilesShown(): boolean;
  /** Leaflet 지도 (시험용) */
  readonly map: L.Map;
  destroy(): void;
}

const ACCENT = '#ffb224';

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
    if (line.length >= 2) {
      const pts = course.kind === 'loop' ? [...line, line[0]!] : line;
      L.polyline(pts, { color: '#eceef0', opacity: 0.22, weight: 10, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(courseLayer);
      L.polyline(pts, { color: '#c9cdd2', opacity: 0.9, weight: 1.5, lineJoin: 'round', interactive: false }).addTo(courseLayer);
    }
    const gate = (g: Course['startGate'], text: string, dashed: boolean) => {
      const s = gateSegment(g, course.origin);
      const a = fromLocal(course.origin, s.ax, s.ay);
      const b = fromLocal(course.origin, s.bx, s.by);
      L.polyline(
        [
          [a.lat, a.lon],
          [b.lat, b.lon],
        ],
        { color: '#eceef0', weight: 3, lineCap: 'round', dashArray: dashed ? '4 3' : undefined, interactive: false },
      ).addTo(courseLayer);
      // 이름은 진행 방향 반대쪽 20 m
      const at = fromLocal(course.origin, s.cx - s.dx * 20, s.cy - s.dy * 20);
      L.marker([at.lat, at.lon], { icon: L.divIcon({ className: 'map-label', html: text, iconSize: [32, 16], iconAnchor: [16, 8] }), interactive: false, keyboard: false }).addTo(courseLayer);
    };
    gate(course.startGate, '출발', false);
    if (course.kind === 'point_to_point') gate(course.finishGate, '도착', true);
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
      if (pts.length === 1 || !course) map.setView(pts[pts.length - 1]!, 16, { animate: false });
      else map.fitBounds(L.latLngBounds(pts), { padding: [44, 44], maxZoom: 17, animate: false });
    });
  }

  return {
    update(course, me) {
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
        move(() => map.panTo([me.lat, me.lon], { animate: false }));
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
        L.circleMarker(at, { radius: 7, color: '#0d0e10', weight: 2, fillColor: '#5cb8ff', fillOpacity: stale ? 0.45 : 1, opacity: stale ? 0.45 : 1, interactive: false }).addTo(friendLayer);
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
        if (pts.length === 1) map.setView(pts[0]!, 16, { animate: false });
        else map.fitBounds(L.latLngBounds(pts), { padding: [56, 56], maxZoom: 16, animate: false });
      });
    },
    locate(me) {
      userMoved = false;
      move(() => map.setView([me.lat, me.lon], Math.max(map.getZoom(), 16), { animate: false }));
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
  /** 점들이 화면을 꽉 채우게 (아래 띠 높이만큼 비움) */
  fit(points: Array<[number, number]>, insetBottom: number): void;
  /** 내 위치를 아래 띠를 뺀 화면 가운데에, 가깝게 */
  follow(lat: number, lon: number, insetBottom: number): void;
  /** 위경도 → 지도 안의 화면 좌표 (px) */
  project(lat: number, lon: number): { x: number; y: number };
  setOnline(online: boolean): void;
  destroy(): void;
}

export const FOLLOW_ZOOM = 17;

export function createReplayMap(el: HTMLElement): ReplayMapController {
  // 재생 화면은 두 번 탭으로 모드를 바꾸므로 지도 조작은 모두 끈다
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    zoomSnap: 0,
    fadeAnimation: false,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.setPosition('topleft');
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
    fit(points, insetBottom) {
      if (points.length === 0) return;
      map.invalidateSize({ pan: false });
      if (points.length === 1) map.setView(points[0]!, FOLLOW_ZOOM, { animate: false });
      else map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [20, 20], paddingBottomRight: [20, 20 + insetBottom], maxZoom: 18, animate: false });
    },
    follow(lat, lon, insetBottom) {
      map.invalidateSize({ pan: false });
      // 아래 띠에 가리지 않게 위로 띠 높이의 절반만큼
      const c = map.project([lat, lon], FOLLOW_ZOOM).add([0, insetBottom / 2]);
      map.setView(map.unproject(c, FOLLOW_ZOOM), FOLLOW_ZOOM, { animate: false });
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
