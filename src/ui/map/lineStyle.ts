// 선 지도 모양 (사양서 8.9, 사용자 요청 시안 2): 우리 앱 색으로 칠한 OSM 벡터 지도 (Protomaps 형식).
// 땅은 칸 색, 바다·물은 더 어두운 숯색, 도로는 포인트 하늘색(고속도로가 가장 밝고 작은 길은 회색으로 옅게), 도 경계는 옅은 점선.
// 지명: 시는 밝은 회색 굵게, 읍·면은 확대하면, 산(▲)은 더 확대하면. 한글은 폰 글꼴로 그리고(localIdeographFontFamily),
// 숫자·기호만 서버의 글자 조각(Noto Sans)을 쓴다.
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';

export const LINE_MAP_COLORS = {
  sea: '#08090a',
  land: '#101114',
  waterEdge: '#22262b',
  region: '#2a2e33',
  country: '#3a3f45',
  road: '#aacae6',
  minorRoad: '#9aa1a9',
  city: '#c9cdd2',
  town: '#8a9199',
  faint: '#5e656d',
  halo: '#0b0c0e',
} as const;

export const LINE_MAP_FONTS = { regular: 'Noto Sans Regular', bold: 'Noto Sans Medium' } as const;

/** 한글은 폰 글꼴로 (앱 글꼴 → 아이폰·안드로이드 기본) */
export const LOCAL_HANGUL_FONT = "'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

const C = LINE_MAP_COLORS;
const name: ExpressionSpecification = ['coalesce', ['get', 'name:ko'], ['get', 'name']];
/** 확대에 따라 굵어지는 도로 폭 (a: 6단계, b: 14단계) */
const roadW = (a: number, b: number): ExpressionSpecification => ['interpolate', ['exponential', 1.6], ['zoom'], 6, a, 14, b];
const round = { 'line-join': 'round', 'line-cap': 'round' } as const;

export function lineMapStyle(opts: { tiles: string; glyphs: string; maxzoom: number }): StyleSpecification {
  return {
    version: 8,
    glyphs: opts.glyphs,
    sources: {
      pm: { type: 'vector', tiles: [opts.tiles], minzoom: 0, maxzoom: opts.maxzoom, attribution: '© OpenStreetMap' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': C.sea } },
      { id: 'earth', type: 'fill', source: 'pm', 'source-layer': 'earth', paint: { 'fill-color': C.land } },
      { id: 'water', type: 'fill', source: 'pm', 'source-layer': 'water', paint: { 'fill-color': C.sea } },
      { id: 'water-edge', type: 'line', source: 'pm', 'source-layer': 'water', paint: { 'line-color': C.waterEdge, 'line-width': 0.7 } },
      {
        id: 'region',
        type: 'line',
        source: 'pm',
        'source-layer': 'boundaries',
        filter: ['!=', ['get', 'kind'], 'country'],
        paint: { 'line-color': C.region, 'line-width': 0.9, 'line-dasharray': [3, 2] },
      },
      { id: 'country', type: 'line', source: 'pm', 'source-layer': 'boundaries', filter: ['==', ['get', 'kind'], 'country'], paint: { 'line-color': C.country, 'line-width': 1.1 } },
      {
        id: 'road-minor',
        type: 'line',
        source: 'pm',
        'source-layer': 'roads',
        minzoom: 11,
        filter: ['in', ['get', 'kind'], ['literal', ['minor_road', 'other']]],
        layout: round,
        paint: { 'line-color': C.minorRoad, 'line-opacity': 0.2, 'line-width': roadW(0.3, 1.4) },
      },
      {
        id: 'road-major',
        type: 'line',
        source: 'pm',
        'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'major_road'],
        layout: round,
        paint: { 'line-color': C.road, 'line-opacity': 0.34, 'line-width': roadW(0.45, 2.6) },
      },
      {
        id: 'road-highway',
        type: 'line',
        source: 'pm',
        'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'highway'],
        layout: round,
        paint: { 'line-color': C.road, 'line-opacity': 0.62, 'line-width': roadW(0.7, 3.4) },
      },
      {
        id: 'name-region',
        type: 'symbol',
        source: 'pm',
        'source-layer': 'places',
        maxzoom: 8.5,
        filter: ['==', ['get', 'kind'], 'region'],
        layout: { 'text-field': name, 'text-font': [LINE_MAP_FONTS.bold], 'text-size': 12, 'text-letter-spacing': 0.15 },
        paint: { 'text-color': C.faint, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
      },
      {
        id: 'name-peak',
        type: 'symbol',
        source: 'pm',
        'source-layer': 'pois',
        minzoom: 11,
        filter: ['==', ['get', 'kind'], 'peak'],
        layout: { 'text-field': ['concat', '▲ ', name], 'text-font': [LINE_MAP_FONTS.regular], 'text-size': 11 },
        paint: { 'text-color': C.faint, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
      },
      {
        id: 'name-town',
        type: 'symbol',
        source: 'pm',
        'source-layer': 'places',
        minzoom: 9,
        filter: ['all', ['==', ['get', 'kind'], 'locality'], ['!=', ['get', 'kind_detail'], 'city']],
        layout: { 'text-field': name, 'text-font': [LINE_MAP_FONTS.regular], 'text-size': 12 },
        paint: { 'text-color': C.town, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
      },
      {
        id: 'name-city',
        type: 'symbol',
        source: 'pm',
        'source-layer': 'places',
        filter: ['all', ['==', ['get', 'kind'], 'locality'], ['==', ['get', 'kind_detail'], 'city']],
        layout: { 'text-field': name, 'text-font': [LINE_MAP_FONTS.bold], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 14] },
        paint: { 'text-color': C.city, 'text-halo-color': C.halo, 'text-halo-width': 1.6 },
      },
    ],
  };
}

/** 서버 주소 → 선 지도 타일·글자 주소 */
export function lineMapUrls(apiUrl: string): { tiles: string; glyphs: string; info: string } {
  return {
    tiles: `${apiUrl}/map/tiles/{z}/{x}/{y}.mvt`,
    glyphs: `${apiUrl}/map/fonts/{fontstack}/{range}.pbf`,
    info: `${apiUrl}/map/info`,
  };
}
