// 선 지도 메인 지도 (사양서 8.2, 8.9): 코스, 내 위치(오차 원 · 점 · "나"), 위치 공유 중인 친구.
// 사진 지도(leafletMap.createMainMap)와 같은 동작: 코스가 바뀌거나 처음 위치를 받으면 맞추고, 코스가 없으면 내 위치를 따라가다가
// 사용자가 지도를 옮기면 멈춘다 (GPS 아이콘을 누르면 다시). 내 위치는 위·아래 칸에 가려지지 않은 영역의 가운데.
import { Marker } from 'maplibre-gl';
import type { Course } from '../../types/course';
import { PIN_TOP_PX } from './courseStyle';
import { addCourseLayers, boundsOf, emptyFC, newLineMap, setData, type CourseLayers } from './lineMap';
import { circlePolygon, lineZoom, mainCourseShapes } from './lineShapes';
import type { LineMapConfig } from './lineMapSupport';
import type { FriendMarker, MainMapApi, MapFix } from './mapTypes';

const ACCENT = '#aacae6';
const FRIEND = '#b78cff';
const STALE_MS = 30_000;

export function createLineMainMap(el: HTMLElement, cfg: LineMapConfig, onTiles?: (shown: boolean) => void): MainMapApi {
  const map = newLineMap(el, cfg);
  let loaded = false;
  let course: CourseLayers | null = null;
  let courseKey: string | null = null;
  let lastCourse: Course | null = null;
  let lastMe: MapFix | null = null;
  let friends: FriendMarker[] = [];
  let inset = { top: 0, bottom: 0 };
  let haveMe = false;
  let userMoved = false;
  let meLabel: Marker | null = null;
  let friendLabels: Marker[] = [];

  // 손으로 옮기거나 확대하면 따라가기를 멈춘다 (코드로 옮길 때는 originalEvent가 없다)
  map.on('dragstart', () => {
    userMoved = true;
  });
  map.on('zoomstart', (e) => {
    if (e.originalEvent) userMoved = true;
  });

  const pad = (n: number, extraTop = 0) => ({ top: n + inset.top + extraTop, bottom: n + inset.bottom, left: n, right: n });

  map.on('load', () => {
    loaded = true;
    course = addCourseLayers(map);
    // 내 위치: 오차 원, 둘레 빛, 점
    map.addSource('me-acc', { type: 'geojson', data: emptyFC() });
    map.addSource('me', { type: 'geojson', data: emptyFC() });
    map.addSource('friends', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'me-acc', type: 'fill', source: 'me-acc', paint: { 'fill-color': ACCENT, 'fill-opacity': 0.08 } });
    map.addLayer({ id: 'me-acc-line', type: 'line', source: 'me-acc', paint: { 'line-color': ACCENT, 'line-opacity': 0.35, 'line-width': 1 } });
    map.addLayer({ id: 'friends', type: 'circle', source: 'friends', paint: { 'circle-radius': 7, 'circle-color': FRIEND, 'circle-opacity': ['case', ['get', 'stale'], 0.45, 1], 'circle-stroke-color': '#0d0e10', 'circle-stroke-width': 2, 'circle-stroke-opacity': ['case', ['get', 'stale'], 0.45, 1] } });
    map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 16, 'circle-color': ACCENT, 'circle-opacity': 0.16 } });
    map.addLayer({ id: 'me-dot', type: 'circle', source: 'me', paint: { 'circle-radius': 6.5, 'circle-color': '#eceef0', 'circle-stroke-color': ACCENT, 'circle-stroke-width': 3 } });
    onTiles?.(true);
    drawCourse(lastCourse);
    drawMe(lastMe);
    drawFriends();
    if (lastCourse || lastMe) fit(lastCourse, lastMe);
  });

  function drawCourse(c: Course | null) {
    if (!course) return;
    course.apply(c ? mainCourseShapes(c) : []);
  }

  function drawMe(me: MapFix | null) {
    if (!loaded) return;
    setData(map, 'me-acc', me && me.hAcc > 0 ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(me.lat, me.lon, me.hAcc)] } } : emptyFC());
    setData(map, 'me', me ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [me.lon, me.lat] } } : emptyFC());
    if (!me) {
      meLabel?.remove();
      meLabel = null;
      return;
    }
    if (!meLabel) {
      const e = document.createElement('span');
      e.className = 'map-label me';
      e.textContent = '나';
      meLabel = new Marker({ element: e, anchor: 'bottom', offset: [0, -16] }).setLngLat([me.lon, me.lat]).addTo(map);
    } else meLabel.setLngLat([me.lon, me.lat]);
  }

  function drawFriends() {
    if (!loaded) return;
    setData(map, 'friends', {
      type: 'FeatureCollection',
      features: friends.map((f) => ({ type: 'Feature', properties: { stale: f.ageMs > STALE_MS }, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } })),
    });
    for (const m of friendLabels) m.remove();
    friendLabels = friends.map((f) => {
      const e = document.createElement('span');
      e.className = `map-label friend${f.ageMs > STALE_MS ? ' stale' : ''}`;
      e.textContent = f.nickname; // 닉네임은 글자로만 (HTML로 해석하지 않는다)
      return new Marker({ element: e, anchor: 'bottom', offset: [0, -10] }).setLngLat([f.lon, f.lat]).addTo(map);
    });
  }

  function fit(c: Course | null, me: MapFix | null) {
    const pts: Array<[number, number]> = [...(c?.centerline ?? [])];
    if (c && pts.length === 0) pts.push([c.startGate.lat, c.startGate.lon]);
    if (me) pts.push([me.lat, me.lon]);
    if (pts.length === 0) return;
    map.resize();
    if (pts.length === 1 || !c) {
      const p = pts[pts.length - 1]!;
      map.jumpTo({ center: [p[1], p[0]], zoom: lineZoom(16), padding: pad(0) });
    } else map.fitBounds(boundsOf(pts), { padding: pad(44, PIN_TOP_PX), maxZoom: lineZoom(17), duration: 0 });
  }

  return {
    update(c, me) {
      lastCourse = c;
      lastMe = me;
      const key = c ? `${c.id}:${c.version}` : null;
      const courseChanged = key !== courseKey;
      if (courseChanged) {
        courseKey = key;
        drawCourse(c);
      }
      drawMe(me);
      // 코스가 바뀌었거나 처음 위치를 받았을 때만 화면을 맞춘다 (사용자가 옮긴 뒤에는 위치가 바뀌어도 그대로)
      const firstFix = me !== null && !haveMe;
      haveMe = me !== null;
      if (courseChanged || (firstFix && !userMoved)) {
        if (courseChanged) userMoved = false;
        fit(c, me);
      } else if (me && !c && !userMoved) {
        // 코스가 없으면 내 위치를 따라간다
        map.jumpTo({ center: [me.lon, me.lat], padding: pad(0) });
      }
    },
    setOnline() {
      // 선 지도는 통신이 돌아오면 알아서 남은 조각을 받는다
    },
    setFriends(list) {
      friends = list;
      drawFriends();
    },
    fitFriends(me) {
      const pts: Array<[number, number]> = friends.map((f) => [f.lat, f.lon]);
      if (me) pts.push([me.lat, me.lon]);
      if (pts.length === 0) return;
      userMoved = true; // 친구를 보는 동안은 내 위치를 따라가지 않는다 (GPS 아이콘을 누르면 다시)
      if (pts.length === 1) map.jumpTo({ center: [pts[0]![1], pts[0]![0]], zoom: lineZoom(16), padding: pad(0) });
      else map.fitBounds(boundsOf(pts), { padding: pad(56), maxZoom: lineZoom(16), duration: 0 });
    },
    locate(me) {
      userMoved = false;
      map.jumpTo({ center: [me.lon, me.lat], zoom: Math.max(map.getZoom(), lineZoom(16)), padding: pad(0) });
    },
    setInsets(top, bottom) {
      if (top === inset.top && bottom === inset.bottom) return;
      inset = { top, bottom };
      map.resize();
      // 사용자가 지도를 옮기지 않았으면 새 영역에 맞춰 다시
      if (!userMoved && (lastCourse || lastMe)) fit(lastCourse, lastMe);
    },
    destroy() {
      course?.remove();
      meLabel?.remove();
      for (const m of friendLabels) m.remove();
      map.remove();
    },
  };
}
