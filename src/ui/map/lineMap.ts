// 선 지도 공통 + 코스 편집 지도 (사양서 8.7, 8.9): 우리 색 OSM 벡터 지도(MapLibre) 위에 코스·출발선·핀·구간을 그린다.
// 사진 지도(leafletMap)와 같은 모양(PickMapController 등)이라 화면 코드는 그대로 쓴다.
// 이 파일은 지도가 처음 필요할 때 따로 불러온다 (MapLibre가 커서).
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { COURSE_STYLE, PIN_TOP_PX, pinElement, sectorLabelElement, type MapShape, type PickMapController } from './courseStyle';
import { LINE_MAP_FONTS, LOCAL_HANGUL_FONT, lineMapStyle } from './lineStyle';
import { lineShapes, lineZoom, type LineShapes } from './lineShapes';
import type { LineMapConfig } from './lineMapSupport';

// 번들 안에서는 MapLibre가 작업 파일 위치를 못 찾으므로 알려 준다
setWorkerUrl(workerUrl);

export type { MapLibreMap };

/** 선 지도 하나 (북쪽 위, 기울이기 없음). interactive=false면 손으로 못 움직인다 (주행·재생) */
export function newLineMap(el: HTMLElement, cfg: LineMapConfig, opts: { interactive?: boolean; attribution?: boolean } = {}): MapLibreMap {
  const interactive = opts.interactive ?? true;
  const map = new MapLibreMap({
    container: el,
    style: lineMapStyle(cfg),
    center: [127.8, 36.5],
    zoom: lineZoom(7),
    attributionControl: opts.attribution === false ? false : { compact: false },
    localIdeographFontFamily: LOCAL_HANGUL_FONT,
    interactive,
    // 아이폰 3배 화면도 2배로 그린다 (선만 그린 지도라 차이가 거의 없고 훨씬 가볍다)
    pixelRatio: Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2),
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
    fadeDuration: 0,
  });
  if (interactive) {
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
  }
  return map;
}

export const emptyFC = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export function setData(map: MapLibreMap, id: string, data: unknown): void {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as GeoJSON.FeatureCollection);
}

const SOURCES = ['routes', 'gates', 'lines', 'dashed', 'dots', 'sectorDots', 'blockers'] as const satisfies ReadonlyArray<keyof LineShapes>;

/** 출발·도착 핀 사이가 이만큼(px)보다 가까우면 FINISH 글자를 숨긴다 (START / FINISH 글자 폭) */
export const PIN_CROWD_PX = 72;
/** 이만큼보다 가까우면 도착 핀도 숨긴다 (핀 폭 26 px) */
export const PIN_STACK_PX = 30;

export interface CourseLayers {
  /** 모양을 바꿔 그린다 (핀·구간 글자는 HTML 표시) */
  apply(shapes: readonly MapShape[]): void;
  remove(): void;
}

/** 코스 선·출발선·도착선·구간·핀 층. 지도가 load된 뒤에 부른다 */
export function addCourseLayers(map: MapLibreMap): CourseLayers {
  for (const id of SOURCES) map.addSource(`c-${id}`, { type: 'geojson', data: emptyFC() });
  const round = { 'line-join': 'round', 'line-cap': 'round' } as const;
  // 코스 선: 하얀 테두리 + 밝은 하늘색 (주행 지도와 같게, 사용자 요청)
  map.addLayer({ id: 'c-route-glow', type: 'line', source: 'c-routes', layout: round, paint: { 'line-color': COURSE_STYLE.routeOutline, 'line-width': 9 } });
  map.addLayer({ id: 'c-route', type: 'line', source: 'c-routes', layout: round, paint: { 'line-color': COURSE_STYLE.route, 'line-width': 5 } });
  // 다른 선 (새 코스의 방향 점선 등)
  map.addLayer({ id: 'c-lines', type: 'line', source: 'c-lines', layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'weight'], 'line-opacity': ['get', 'opacity'] } });
  map.addLayer({ id: 'c-dashed', type: 'line', source: 'c-dashed', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'weight'], 'line-opacity': ['get', 'opacity'], 'line-dasharray': [2, 1.4] } });
  // 출발선 파랑 · 도착선 흰 점선, 검은 테두리
  map.addLayer({ id: 'c-gate-outline', type: 'line', source: 'c-gates', layout: { 'line-cap': 'round' }, paint: { 'line-color': COURSE_STYLE.outline, 'line-width': 6.5 } });
  map.addLayer({ id: 'c-gate-start', type: 'line', source: 'c-gates', filter: ['==', ['get', 'which'], 'start'], layout: { 'line-cap': 'round' }, paint: { 'line-color': COURSE_STYLE.start, 'line-width': 3.5 } });
  map.addLayer({ id: 'c-gate-finish', type: 'line', source: 'c-gates', filter: ['==', ['get', 'which'], 'finish'], paint: { 'line-color': '#ffffff', 'line-width': 3.5, 'line-dasharray': [1.15, 0.85] } });
  map.addLayer({ id: 'c-dots', type: 'circle', source: 'c-dots', paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0d0e10', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'c-sector-dots', type: 'circle', source: 'c-sectorDots', paint: { 'circle-radius': 7, 'circle-color': COURSE_STYLE.sector, 'circle-stroke-color': COURSE_STYLE.outline, 'circle-stroke-width': 2.5 } });
  // 핀·구간 글자 자리 (보이지 않음): 지명이 우리 글자와 겹치지 않게 피해 간다
  map.addLayer({
    id: 'c-blockers',
    type: 'symbol',
    source: 'c-blockers',
    layout: {
      'text-field': ['get', 't'],
      'text-font': [LINE_MAP_FONTS.bold],
      'text-size': ['get', 's'],
      'text-anchor': 'bottom',
      'text-offset': ['get', 'o'],
      'text-allow-overlap': true,
      'text-ignore-placement': false,
      'text-padding': 4,
    },
    paint: { 'text-opacity': 0 },
  });

  let markers: Marker[] = [];
  let pins: Array<{ el: HTMLElement; at: [number, number] }> = [];
  const clearMarkers = () => {
    for (const m of markers) m.remove();
    markers = [];
    pins = [];
  };
  // 넓게 보면 출발·도착 핀이 겹친다: 가까우면 FINISH 글자를, 아주 가까우면 도착 핀을 숨긴다 (START만 남긴다)
  const declutter = () => {
    if (pins.length !== 2) return;
    const [a, b] = pins.map((p) => map.project(p.at));
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    const finish = pins[1]!.el;
    finish.classList.toggle('crowded', d < PIN_CROWD_PX);
    finish.classList.toggle('stacked', d < PIN_STACK_PX);
  };
  map.on('zoom', declutter);
  return {
    apply(shapes) {
      const g = lineShapes(shapes);
      for (const id of SOURCES) setData(map, `c-${id}`, g[id]);
      clearMarkers();
      for (const s of g.sectors) {
        const e = sectorLabelElement(s.text);
        e.className = 'map-label big map-sector';
        markers.push(new Marker({ element: e, anchor: 'bottom', offset: [0, -12] }).setLngLat(s.at).addTo(map));
      }
      for (const l of g.labels) {
        const e = document.createElement('span');
        e.className = 'map-label';
        e.textContent = l.text;
        markers.push(new Marker({ element: e, anchor: 'bottom', offset: [0, -8] }).setLngLat(l.at).addTo(map));
      }
      // 핀은 마지막 (맨 위)
      for (const p of g.pins) {
        const e = pinElement(p.which, p.text);
        e.className = `map-pin ${p.which}`;
        e.style.width = '26px';
        e.style.height = '36px';
        markers.push(new Marker({ element: e, anchor: 'bottom' }).setLngLat(p.at).addTo(map));
        pins.push({ el: e, at: p.at });
      }
      pins.sort((x, y) => (x.el.classList.contains('start') ? 0 : 1) - (y.el.classList.contains('start') ? 0 : 1));
      declutter();
    },
    remove() {
      map.off('zoom', declutter);
      clearMarkers();
    },
  };
}

/** [위도, 경도] 점들 → 경계 */
export function boundsOf(pts: ReadonlyArray<readonly [number, number]>): LngLatBounds {
  const b = new LngLatBounds();
  for (const [lat, lon] of pts) b.extend([lon, lat]);
  return b;
}

export function createLinePickMap(el: HTMLElement, onPick: (lat: number, lon: number) => void, cfg: LineMapConfig): PickMapController {
  const map = newLineMap(el, cfg);
  map.on('click', (e) => onPick(e.lngLat.lat, e.lngLat.lng));
  let course: CourseLayers | null = null;
  let pending: { shapes: MapShape[]; fit?: Array<[number, number]> } | null = null;

  map.on('load', () => {
    course = addCourseLayers(map);
    if (pending) apply(pending.shapes, pending.fit);
    pending = null;
  });

  function apply(shapes: MapShape[], fit?: Array<[number, number]>) {
    course?.apply(shapes);
    if (fit && fit.length) {
      map.resize();
      if (fit.length === 1) map.jumpTo({ center: [fit[0]![1], fit[0]![0]], zoom: lineZoom(17) });
      else map.fitBounds(boundsOf(fit), { padding: { top: 32 + PIN_TOP_PX, bottom: 32, left: 32, right: 32 }, maxZoom: lineZoom(18), duration: 0 });
    }
  }

  return {
    setShapes(shapes, fit) {
      if (course) apply(shapes, fit);
      else pending = { shapes, fit: fit ?? pending?.fit };
    },
    center(at, zoom) {
      map.jumpTo({ center: [at[1], at[0]], zoom: lineZoom(zoom) });
    },
    setOnline() {
      // 선 지도는 통신이 돌아오면 알아서 남은 조각을 받는다
    },
    destroy() {
      course?.remove();
      map.remove();
    },
  };
}
