// GPX → 코스 (사양서 7.5 GPX 불러오기), GPX → 주행 기록 (사양서 8.7)
import { config } from '../engine/config';
import { toLocal } from '../engine/geo';
import { centerlineFromPath, withCenterline } from '../engine/course/edit';
import { gateFromPoint } from '../engine/course/geometry';
import { polylinePoint } from '../engine/course/polyline';
import type { Course } from '../types/course';
import type { GpsSample } from '../types/samples';
import type { GpxData } from './parse';

/** 이 앱이 내보낸 GPX의 creator. 이미 다듬은 1 m 중심선이라 다시 평활하지 않는다 (왕복해도 같은 코스) */
export const GPX_CREATOR = '같이타요';

/** 평활 후 1 m 재샘플. 양 끝이 30 m 이내면 랩 코스, 아니면 편도. 게이트는 양 끝점과 그곳의 진행 방향 */
export function courseFromGpx(gpx: GpxData, opts: { id: string; name: string }): Course {
  const first = gpx.points[0]!;
  const origin = { lat: first.lat, lon: first.lon };
  const xy = gpx.points.map((p) => toLocal(origin, p.lat, p.lon));
  const a = xy[0]!;
  const b = xy[xy.length - 1]!;
  const loop = xy.length > 2 && Math.hypot(b.x - a.x, b.y - a.y) <= config.course.auto.loopReturnRadiusM;
  // 랩 코스의 마지막 점이 첫 점과 거의 같으면 빼고 닫는다
  const pts = loop && Math.hypot(b.x - a.x, b.y - a.y) < 0.5 ? xy.slice(0, -1) : xy;
  const cl = centerlineFromPath(
    pts.map((p) => p.x),
    pts.map((p) => p.y),
    loop,
    gpx.creator !== GPX_CREATOR,
  );
  const s0 = polylinePoint(cl, 0);
  const s1 = polylinePoint(cl, cl.length);
  const start = gateFromPoint(s0.x, s0.y, polylinePoint(cl, Math.min(1, cl.length)).psi, origin);
  const finish = loop ? start : gateFromPoint(s1.x, s1.y, s1.psi, origin);
  return withCenterline(
    {
      id: opts.id,
      name: opts.name,
      kind: loop ? 'loop' : 'point_to_point',
      source: 'gpx',
      origin,
      startGate: start,
      finishGate: finish,
      centerline: null,
      lengthM: null,
      sectorBoundsM: null,
      version: 1,
    },
    cl,
  );
}

/** 시간 정보가 있는 GPX → 모션 없이 GPS만 있는 주행 기록 */
export function gpsSamplesFromGpx(gpx: GpxData): GpsSample[] {
  if (!gpx.hasTime) throw new Error('시간 정보가 없는 GPX는 코스로만 등록할 수 있습니다');
  const t0 = gpx.points[0]!.time!;
  return gpx.points.map((p) => ({
    tRecv: p.time! - t0,
    tFix: p.time!,
    lat: p.lat,
    lon: p.lon,
    alt: p.ele,
    altAcc: null,
    hAcc: config.gpx.defaultHAccM,
    speed: p.speed,
    heading: null,
  }));
}
