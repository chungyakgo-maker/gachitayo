// 코스 편집 지도 모양(MapShape, [위도, 경도]) → 선 지도(MapLibre)에 넣을 GeoJSON ([경도, 위도])과 글자·핀 목록.
// 지도 라이브러리를 가져오지 않는 순수 변환이라 jsdom 테스트로 확인한다.
import type { GateWhich, MapShape } from './courseStyle';

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

/** 핀 글자는 핀 위(아래 기준 2.2em 위, 17px), 구간 글자는 점 위 12px(15px 글자 → 0.8em) */
export const PIN_TEXT = { size: 17, offset: [0, -2.2] } as const;
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
