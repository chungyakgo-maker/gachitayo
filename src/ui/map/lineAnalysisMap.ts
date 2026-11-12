// 선 지도 분석 지도 (사양서 8.6, 8.9): 랩 A는 속도로 색칠, 랩 B는 회색 점선, 고른 지점. 누르면 그 위치를 알려 준다.
import type { LineMapConfig } from './lineMapSupport';
import { boundsOf, emptyFC, newLineMap, setData } from './lineMap';
import { lapSegments } from './lineShapes';
import type { AnalysisLapLine, AnalysisMapController } from './mapTypes';

const ACCENT = '#aacae6';

export function createLineAnalysisMap(el: HTMLElement, onPick: (lat: number, lon: number) => void, cfg: LineMapConfig): AnalysisMapController {
  const map = newLineMap(el, cfg);
  map.on('click', (e) => onPick(e.lngLat.lat, e.lngLat.lng));
  let loaded = false;
  let pending: { a: AnalysisLapLine | null; b: AnalysisLapLine | null; fit: boolean; marker: [number, number] | null } = { a: null, b: null, fit: false, marker: null };

  map.on('load', () => {
    // 짧은 조각이 넓게 볼 때 사라지지 않게 단순화하지 않는다 (사진 지도처럼 다 그린다)
    map.addSource('lap-a', { type: 'geojson', data: emptyFC(), tolerance: 0 });
    map.addSource('lap-b', { type: 'geojson', data: emptyFC(), tolerance: 0 });
    map.addSource('mark', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'lap-b', type: 'line', source: 'lap-b', paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.8, 'line-dasharray': [2, 1.7] } });
    map.addLayer({ id: 'lap-a', type: 'line', source: 'lap-a', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.95 } });
    map.addLayer({ id: 'mark-halo', type: 'circle', source: 'mark', paint: { 'circle-radius': 14, 'circle-color': ACCENT, 'circle-opacity': 0.25 } });
    map.addLayer({ id: 'mark', type: 'circle', source: 'mark', paint: { 'circle-radius': 6, 'circle-color': '#eceef0', 'circle-stroke-color': '#0d0e10', 'circle-stroke-width': 2 } });
    loaded = true;
    lines(pending.a, pending.b, pending.fit);
    marker(pending.marker);
  });

  function lines(a: AnalysisLapLine | null, b: AnalysisLapLine | null, fit: boolean) {
    setData(map, 'lap-a', { type: 'FeatureCollection', features: lapSegments(a, ACCENT) });
    setData(map, 'lap-b', { type: 'FeatureCollection', features: lapSegments(b, '#9aa1a9') });
    if (fit) {
      const all = [...(a?.pts ?? []), ...(b?.pts ?? [])];
      map.resize();
      if (all.length >= 2) map.fitBounds(boundsOf(all), { padding: 24, duration: 0 });
    }
  }
  function marker(at: [number, number] | null) {
    setData(map, 'mark', at ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [at[1], at[0]] } } : emptyFC());
  }

  return {
    setLines(a, b, fit) {
      if (loaded) lines(a, b, fit);
      else pending = { ...pending, a, b, fit: fit || pending.fit };
    },
    setMarker(at) {
      if (loaded) marker(at);
      else pending = { ...pending, marker: at };
    },
    setOnline() {
      // 선 지도는 통신이 돌아오면 알아서 남은 조각을 받는다
    },
    destroy() {
      map.remove();
    },
  };
}
