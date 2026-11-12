// 테스트용: 생성기 코스 모양에서 바로 코스를 만든다 (정답 중심선)
import type { Track } from '../../generators';
import { fromLocal, type LatLon } from '../../../src/engine/geo';
import { gateFromPoint } from '../../../src/engine/course/geometry';
import type { Course } from '../../../src/types/course';

export const ORIGIN: LatLon = { lat: 37.2, lon: 127.1 };

export function courseFromTrack(track: Track, opts: { id?: string; widthM?: number } = {}): Course {
  const pts: Array<[number, number]> = [];
  const n = Math.round(track.length);
  for (let i = 0; i <= n; i++) {
    const p = track.pointAt((i / n) * track.length);
    const ll = fromLocal(ORIGIN, p.x, p.y);
    pts.push([ll.lat, ll.lon]);
  }
  const s = track.pointAt(0);
  const e = track.pointAt(track.length);
  const start = gateFromPoint(s.x, s.y, s.psi, ORIGIN, opts.widthM ?? 30);
  return {
    id: opts.id ?? 'c1',
    name: '테스트 코스',
    kind: track.closed ? 'loop' : 'point_to_point',
    source: 'auto',
    origin: ORIGIN,
    startGate: start,
    finishGate: track.closed ? start : gateFromPoint(e.x, e.y, e.psi, ORIGIN, opts.widthM ?? 30),
    centerline: pts,
    lengthM: track.length,
    sectorBoundsM: [track.length / 3, (2 * track.length) / 3],
    version: 1,
  };
}
