// 코스 편집 지도 모양(MapShape, [위도, 경도]) → 선 지도(MapLibre)에 넣을 GeoJSON ([경도, 위도])과 글자·핀 목록.
// 지도 라이브러리를 가져오지 않는 순수 변환이라 jsdom 테스트로 확인한다.
import { gateSegment } from '../../engine/course/geometry';
import { fromLocal } from '../../engine/geo';
import { PIN_LABEL, type GateWhich, type MapShape } from './courseStyle';

type LngLat = [number, number];
interface Feature {
  type: 'Feature';
  properties: Record<string, string | number | number[]>;
  geometry: { type: 'LineString'; coordinates: LngLat[] } | { type: 'Point'; coordinates: LngLat };
}
export interface FC {
  type: 'FeatureCollection';
  features: Feature[];
}

export interface LineShapes {
  routes: FC;
  /** 출발선·도착선 (which) */
  gates: FC;
  /** 실선 (color, weight, opacity) */
  lines: FC;
  /** 점선 (color, weight, opacity) */
  dashed: FC;
  /** 점 (color, r) */
  dots: FC;
  sectorDots: FC;
  /** 지명이 피해 가게 할 우리 글자 자리 (t 글자, s 크기, a 기준, o 위치 em) */
  blockers: FC;
  pins: Array<{ at: LngLat; which: GateWhich; text: string }>;
  sectors: Array<{ at: LngLat; text: string }>;
  labels: Array<{ at: LngLat; text: string }>;
}

const ll = (p: [number, number]): LngLat => [p[1], p[0]];
const fc = (features: Feature[]): FC => ({ type: 'FeatureCollection', features });
const line = (pts: Array<[number, number]>, properties: Feature['properties'] = {}): Feature => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: pts.map(ll) } });
const point = (at: [number, number], properties: Feature['properties'] = {}): Feature => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: ll(at) } });

/** 핀 글자는 핀 위(핀 36px + 2px, 13px 글자 → 2.9em), 구간 글자는 점 위 12px(15px 글자 → 0.8em) */
export const PIN_TEXT = { size: 13, offset: [0, -2.9] } as const;
export const SECTOR_TEXT = { size: 15, offset: [0, -0.8] } as const;

export function lineShapes(shapes: readonly MapShape[]): LineShapes {
  const routes: Feature[] = [];
  const gates: Feature[] = [];
  const lines: Feature[] = [];
  const dashed: Feature[] = [];
  const dots: Feature[] = [];
  const sectorDots: Feature[] = [];
  const blockers: Feature[] = [];
  const out: Pick<LineShapes, 'pins' | 'sectors' | 'labels'> = { pins: [], sectors: [], labels: [] };
  for (const s of shapes) {
    switch (s.kind) {
      case 'route':
        if (s.pts.length >= 2) routes.push(line(s.pts));
        break;
      case 'gate':
        gates.push(line([s.a, s.b], { which: s.which }));
        break;
      case 'line':
        if (s.pts.length >= 2) (s.dash ? dashed : lines).push(line(s.pts, { color: s.color, weight: s.weight, opacity: s.opacity ?? 1 }));
        break;
      case 'dot':
        dots.push(point(s.at, { color: s.color, r: s.r }));
        break;
      case 'sector':
        sectorDots.push(point(s.at));
        out.sectors.push({ at: ll(s.at), text: s.text });
        blockers.push(point(s.at, { t: s.text, s: SECTOR_TEXT.size, a: 'bottom', o: [...SECTOR_TEXT.offset] }));
        break;
      case 'pin':
        out.pins.push({ at: ll(s.at), which: s.which, text: s.text });
        blockers.push(point(s.at, { t: s.text, s: PIN_TEXT.size, a: 'bottom', o: [...PIN_TEXT.offset] }));
        break;
      case 'label':
        out.labels.push({ at: ll(s.at), text: s.text });
        break;
    }
  }
  return { routes: fc(routes), gates: fc(gates), lines: fc(lines), dashed: fc(dashed), dots: fc(dots), sectorDots: fc(sectorDots), blockers: fc(blockers), ...out };
}

// ── 메인·주행 지도용 순수 도우미 ──

/** 사진 지도(Leaflet, 256px 타일) 확대 단계 → 선 지도(MapLibre, 512px 타일)에서 같은 넓이의 단계 */
export const lineZoom = (leafletZoom: number): number => leafletZoom - 1;

/** 코스 방향(동쪽 0, 반시계, 라디안) → 나침반 방위(북 0, 시계, °) */
export function headingToBearing(psi: number): number {
  const b = 90 - (psi * 180) / Math.PI;
  return ((b % 360) + 360) % 360;
}

/** 위치 오차 원 (반지름 m) → 다각형 [경도, 위도] (n개 점, 닫힘) */
export function circlePolygon(lat: number, lon: number, radiusM: number, n = 48): LngLat[] {
  const out: LngLat[] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

/** 메인 지도의 코스 모양: 코스 선, 출발선(편도면 도착선), 핀 (구간 경계는 없음) */
export function mainCourseShapes(course: import('../../types/course').Course): MapShape[] {
  const shapes: MapShape[] = [];
  const line = course.centerline ?? [];
  if (line.length >= 2) shapes.push({ kind: 'route', pts: course.kind === 'loop' ? [...line, line[0]!] : line });
  const pins: MapShape[] = [];
  const gate = (g: import('../../types/course').Gate, which: GateWhich, text: string) => {
    const s = gateSegment(g, course.origin);
    const a = fromLocal(course.origin, s.ax, s.ay);
    const b = fromLocal(course.origin, s.bx, s.by);
    shapes.push({ kind: 'gate', a: [a.lat, a.lon], b: [b.lat, b.lon], which });
    pins.push({ kind: 'pin', at: [g.lat, g.lon], which, text });
  };
  gate(course.startGate, 'start', PIN_LABEL.start);
  if (course.kind === 'point_to_point') gate(course.finishGate, 'finish', PIN_LABEL.finish);
  return [...shapes, ...pins];
}

/** 분석 지도: 랩 선 → 조각들. 점마다 색이 있으면 점 i-1→i 구간을 점 i의 속도 색으로, 같은 색이 이어지면 한 조각으로 묶는다
 *  (조각이 짧으면 넓게 볼 때 지도가 지우므로 묶어서 길게) */
export function lapSegments(lap: import('./mapTypes').AnalysisLapLine | null, fallback: string): Feature[] {
  if (!lap || lap.pts.length < 2) return [];
  if (!lap.colors) return [line(lap.pts, { color: lap.colorAll ?? fallback })];
  const out: Feature[] = [];
  let run: Array<[number, number]> = [lap.pts[0]!];
  let color = lap.colors[1]!;
  for (let i = 1; i < lap.pts.length; i++) {
    const c = lap.colors[i]!;
    if (c !== color) {
      out.push(line(run, { color }));
      run = [lap.pts[i - 1]!];
      color = c;
    }
    run.push(lap.pts[i]!);
  }
  out.push(line(run, { color }));
  return out;
}
