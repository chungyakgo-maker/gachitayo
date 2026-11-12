// 선 지도 코스 편집 지도 (사양서 8.7, 8.9): 우리 색 OSM 벡터 지도(MapLibre) 위에 코스·출발선·핀·구간을 그리고, 누른 곳을 알려 준다.
// 사진 지도(leafletMap.createPickMap)와 같은 모양(PickMapController)이라 화면 코드는 그대로 쓴다.
// 이 파일은 코스 상세가 처음 열릴 때 따로 불러온다 (MapLibre가 커서).
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { COURSE_STYLE, PIN_TOP_PX, pinElement, sectorLabelElement, type MapShape, type PickMapController } from './courseStyle';
import { LINE_MAP_FONTS, LOCAL_HANGUL_FONT, lineMapStyle } from './lineStyle';
import { lineShapes, type LineShapes } from './lineShapes';
import type { LineMapConfig } from './lineMapSupport';

// 번들 안에서는 MapLibre가 작업 파일 위치를 못 찾으므로 알려 준다
setWorkerUrl(workerUrl);

const SOURCES = ['routes', 'gates', 'lines', 'dashed', 'dots', 'sectorDots', 'blockers'] as const satisfies ReadonlyArray<keyof LineShapes>;
const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export function createLinePickMap(el: HTMLElement, onPick: (lat: number, lon: number) => void, cfg: LineMapConfig): PickMapController {
  const map = new MapLibreMap({
    container: el,
    style: lineMapStyle(cfg),
    center: [127.8, 36.5],
    zoom: 6,
    attributionControl: { compact: false },
    localIdeographFontFamily: LOCAL_HANGUL_FONT,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
    fadeDuration: 0,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.on('click', (e) => onPick(e.lngLat.lat, e.lngLat.lng));

  let loaded = false;
  let pending: { shapes: MapShape[]; fit?: Array<[number, number]> } | null = null;
  let markers: Marker[] = [];

  map.on('load', () => {
    for (const id of SOURCES) map.addSource(`c-${id}`, { type: 'geojson', data: empty() });
    const round = { 'line-join': 'round', 'line-cap': 'round' } as const;
    // 코스 선: 빛 번짐 + 진한 빨강 + 가운데 밝은 줄
    map.addLayer({ id: 'c-route-glow', type: 'line', source: 'c-routes', layout: round, paint: { 'line-color': COURSE_STYLE.glow, 'line-width': 16, 'line-opacity': 0.45, 'line-blur': 9 } });
    map.addLayer({ id: 'c-route', type: 'line', source: 'c-routes', layout: round, paint: { 'line-color': COURSE_STYLE.route, 'line-width': 4 } });
    map.addLayer({ id: 'c-route-hi', type: 'line', source: 'c-routes', layout: round, paint: { 'line-color': COURSE_STYLE.highlight, 'line-width': 1.2, 'line-opacity': 0.9 } });
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
    loaded = true;
    if (pending) apply(pending.shapes, pending.fit);
    pending = null;
  });

  function apply(shapes: MapShape[], fit?: Array<[number, number]>) {
    const g = lineShapes(shapes);
    for (const id of SOURCES) (map.getSource(`c-${id}`) as GeoJSONSource | undefined)?.setData(g[id] as GeoJSON.FeatureCollection);
    for (const m of markers) m.remove();
    markers = [];
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
    }
    if (fit && fit.length) {
      map.resize();
      if (fit.length === 1) map.jumpTo({ center: [fit[0]![1], fit[0]![0]], zoom: 17 });
      else {
        const b = new LngLatBounds();
        for (const [lat, lon] of fit) b.extend([lon, lat]);
        map.fitBounds(b, { padding: { top: 32 + PIN_TOP_PX, bottom: 32, left: 32, right: 32 }, maxZoom: 17, duration: 0 });
      }
    }
  }

  return {
    setShapes(shapes, fit) {
      if (loaded) apply(shapes, fit);
      else pending = { shapes, fit: fit ?? pending?.fit };
    },
    center(at, zoom) {
      map.jumpTo({ center: [at[1], at[0]], zoom });
    },
    setOnline() {
      // 선 지도는 통신이 돌아오면 알아서 남은 조각을 받는다
    },
    destroy() {
      for (const m of markers) m.remove();
      map.remove();
    },
  };
}
