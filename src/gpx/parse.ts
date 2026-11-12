// GPX 불러오기 (사양서 7.5, 8.7): trk 점을 쓰고, 없으면 rte 점을 쓴다.
// 속도는 GPX 확장 영역(예: 가민 TrackPointExtension)이나 GPX 1.0의 <speed>에 있으면 읽는다.
// XML 파서는 주입받는다 (사양서 5.1). 기본값은 순수 TS 파서.
import { childText, childrenNamed, findDescendant, localName, parseXml, type XmlNode } from './xml';

export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number | null;
  /** epoch ms */
  time: number | null;
  /** m/s */
  speed: number | null;
}

export interface GpxData {
  name: string | null;
  /** 만든 프로그램 (gpx creator 속성) */
  creator: string | null;
  points: GpxPoint[];
  /** 모든 점에 시간이 있는지 (주행 기록으로 가져올 수 있는지) */
  hasTime: boolean;
  source: 'trk' | 'rte';
  /** 경유점 (카카오맵·네이버 지도 경로는 출발·도착 이름이 여기 있다) */
  waypoints: Array<{ lat: number; lon: number; name: string | null }>;
}

const num = (s: string | null): number | null => {
  if (s === null || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

/** GPX 시각은 UTC다. 시간대 표시가 없으면 Z를 붙여 읽는다 (Date.parse는 기기 시간대로 읽어서 폰마다 결과가 달라진다) */
function parseTime(t: string): number {
  const s = t.trim();
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  return Date.parse(hasZone || !s.includes('T') ? s : `${s}Z`);
}

function readPoint(n: XmlNode): GpxPoint | null {
  const lat = num(n.attrs.lat ?? null);
  const lon = num(n.attrs.lon ?? null);
  if (lat === null || lon === null) return null;
  const t = childText(n, 'time');
  const parsed = t ? parseTime(t) : Number.NaN;
  const ext = childrenNamed(n, 'extensions')[0];
  const speedNode = childrenNamed(n, 'speed')[0] ?? (ext ? findDescendant(ext, 'speed') : null);
  return {
    lat,
    lon,
    ele: num(childText(n, 'ele')),
    time: Number.isFinite(parsed) ? parsed : null,
    speed: speedNode ? num(speedNode.text.trim()) : null,
  };
}

export function parseGpx(text: string, parser: (t: string) => XmlNode = parseXml): GpxData {
  const root = parser(text);
  if (localName(root) !== 'gpx') throw new Error('이 파일은 GPX가 아닙니다');
  const trks = childrenNamed(root, 'trk');
  const rtes = childrenNamed(root, 'rte');
  let source: 'trk' | 'rte' = 'trk';
  let nodes = trks.flatMap((t) => childrenNamed(t, 'trkseg').flatMap((s) => childrenNamed(s, 'trkpt')));
  if (nodes.length === 0) {
    source = 'rte';
    nodes = rtes.flatMap((r) => childrenNamed(r, 'rtept'));
  }
  const points = nodes.map(readPoint).filter((p): p is GpxPoint => p !== null);
  if (points.length === 0) throw new Error('GPX에 위치 점이 없습니다');
  const meta = childrenNamed(root, 'metadata')[0];
  const name =
    (meta && childText(meta, 'name')) || (trks[0] && childText(trks[0], 'name')) || (rtes[0] && childText(rtes[0], 'name')) || null;
  const waypoints = childrenNamed(root, 'wpt').flatMap((w) => {
    const lat = num(w.attrs.lat ?? null);
    const lon = num(w.attrs.lon ?? null);
    return lat === null || lon === null ? [] : [{ lat, lon, name: childText(w, 'name')?.trim() || null }];
  });
  return { name, creator: root.attrs.creator ?? null, points, hasTime: points.every((p) => p.time !== null), source, waypoints };
}

/** 지도 앱이 넣는 뜻 없는 이름 (카카오맵 경로는 늘 "kakaomap") */
const GENERIC_NAME = /^(kakao\s*map|kakaomap(-route)?|naver\s*map|navermap|route|track|gpx|course|untitled|새\s*코스)([\s_-]*\d*)?$/i;

/** 주소에서 짧은 지명: 끝에서부터 리·동·가·읍·면으로 끝나는 말 (예: "강원 춘천시 신북읍 유포리 산 5-13" → "유포리"). 주소가 아니면 그대로 */
function shortPlace(s: string): string {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    for (let i = words.length - 1; i >= 0; i--) if (/[가-힣](리|동|가|읍|면)$/.test(words[i]!)) return words[i]!;
  }
  return s.length > 16 ? `${s.slice(0, 16)}…` : s;
}

/**
 * GPX를 코스로 불러올 때 이름 기본값 (사용자 요청: 카카오맵 GPX는 이름이 모두 "kakaomap"이라 구분이 안 됨).
 * GPX 이름이 뜻 있으면 그것, 아니면 파일 이름, 그것도 뜻 없으면 출발 → 도착 지명
 */
export function suggestedCourseName(g: Pick<GpxData, 'name' | 'waypoints'>, fileName?: string): string {
  const gpxName = g.name?.trim() ?? '';
  if (gpxName && !GENERIC_NAME.test(gpxName)) return gpxName;
  const file = (fileName ?? '').replace(/\.gpx$/i, '').trim();
  if (file && !GENERIC_NAME.test(file)) return file;
  const named = g.waypoints.filter((w) => w.name);
  if (named.length >= 2) return `${shortPlace(named[0]!.name!)} → ${shortPlace(named[named.length - 1]!.name!)}`;
  if (named.length === 1) return shortPlace(named[0]!.name!);
  return gpxName || file || 'GPX 코스';
}
