// 테스트용: 생성기 코스 모양에서 바로 코스를 만든다 (정답 중심선)
import type { Track } from '../../generators';
import { fromLocal, type LatLon } from '../../../src/engine/geo';
import { gateFromPoint } from '../../../src/engine/course/geometry';
import type { Course } from '../../../src/types/course';

export const ORIGIN: LatLon = { lat: 37.2, lon: 127.1 };

export function courseFromTrack(
  track: Track,
  opts: {
    id?: string;
    widthM?: number;
    /** 랩 코스의 출발선 위치 (코스 모양 기준 m) */
    gateAtS?: number;
    /** 편도의 도착선을 끝점보다 이만큼 앞에 둔다 (실제 주행은 도착선을 지나서 멈춘다) */
    finishInsetM?: number;
    /** 편도의 출발선을 시작점보다 이만큼 뒤에 둔다 (정차 위치가 출발선 위면 출발 순간이 애매) */
    startInsetM?: number;
  } = {},
): Course {
  const pts: Array<[number, number]> = [];
  const a0 = track.closed ? 0 : (opts.startInsetM ?? 0);
  const L = track.closed ? track.length : track.length - (opts.finishInsetM ?? 5) - a0;
  const n = Math.round(L);
  const s0 = track.closed ? (opts.gateAtS ?? 0) : 0;
  for (let i = 0; i <= n; i++) {
    const p = track.closed
      ? track.pointAt((s0 + (i / n) * track.length) % track.length)
      : track.pointAt(a0 + (i / n) * L);
    const ll = fromLocal(ORIGIN, p.x, p.y);
    pts.push([ll.lat, ll.lon]);
  }
  if (track.closed) pts[n] = pts[0]!;
  const s = track.pointAt(track.closed ? s0 : a0);
  const e = track.pointAt(a0 + L);
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
    lengthM: L,
    sectorBoundsM: [L / 3, (2 * L) / 3],
    version: 1,
  };
}
