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
}

const num = (s: string | null): number | null => {
  if (s === null || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

function readPoint(n: XmlNode): GpxPoint | null {
  const lat = num(n.attrs.lat ?? null);
  const lon = num(n.attrs.lon ?? null);
  if (lat === null || lon === null) return null;
  const t = childText(n, 'time');
  const parsed = t ? Date.parse(t) : Number.NaN;
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
  return { name, creator: root.attrs.creator ?? null, points, hasTime: points.every((p) => p.time !== null), source };
}
