// 모두의 코스 선 (설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md 2부):
// 폰의 코스 선은 1 m 간격이라 10 km 면 1만 점 — 공개할 때 2 m 오차 안으로 줄여(더글라스-포이커) 보내고, 받을 때 1 m 로 다시 편다.
// 출발선·도착선(게이트)은 줄이지 않고 그대로 보낸다: 같은 코스로 달리려면 랩을 끊는 선이 같아야 한다
import type { Course } from '../../types/course';
import type { LatLonPair, SharedBody } from '../../types/shared';
import { fromLocal, toLocal, type LatLon } from '../geo';
import { makePolyline, resamplePolyline } from './polyline';

export const SHARE_TOLERANCE_M = 2;
const THUMB_MAX = 40;
const LINE_MAX = 5000;

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

function local(pts: LatLonPair[]): { origin: LatLon; x: number[]; y: number[] } {
  const origin = { lat: pts[0]![0], lon: pts[0]![1] };
  const x: number[] = [];
  const y: number[] = [];
  for (const [lat, lon] of pts) {
    const p = toLocal(origin, lat, lon);
    x.push(p.x);
    y.push(p.y);
  }
  return { origin, x, y };
}

/** 더글라스-포이커 줄이기 (끝점 둘은 언제나 남김) */
export function simplifyLine(pts: LatLonPair[], toleranceM: number): LatLonPair[] {
  if (pts.length <= 2) return pts.slice();
  const { x, y } = local(pts);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const dx = x[b]! - x[a]!;
    const dy = y[b]! - y[a]!;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = 0;
    for (let i = a + 1; i < b; i++) {
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x[i]! - x[a]!) * dx + (y[i]! - y[a]!) * dy) / len2)) : 0;
      const d = Math.hypot(x[a]! + dx * t - x[i]!, y[a]! + dy * t - y[i]!);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0 && worstD > toleranceM) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 점 수 한도 안으로 줄이기: 2 m 로 줄이고, 넘으면 허용 오차를 1.5배씩 키운다 (모두의 코스 5000점·팀 방 3000점) */
export function fitLine(pts: LatLonPair[], maxPoints: number): LatLonPair[] {
  let tol = SHARE_TOLERANCE_M;
  let out = simplifyLine(pts, tol);
  while (out.length > maxPoints) {
    tol *= 1.5;
    out = simplifyLine(out, tol);
  }
  return out.map(([lat, lon]) => [round6(lat), round6(lon)] as LatLonPair);
}

/** 줄인 선을 spacingM 간격으로 다시 편다 */
export function expandLine(pts: LatLonPair[], spacingM: number): LatLonPair[] {
  if (pts.length < 2) return pts.slice();
  const { origin, x, y } = local(pts);
  const p = resamplePolyline(makePolyline(x, y), spacingM);
  const out: LatLonPair[] = [];
  for (let i = 0; i < p.x.length; i++) {
    const g = fromLocal(origin, p.x[i]!, p.y[i]!);
    out.push([g.lat, g.lon]);
  }
  return out;
}

/** 공개할 때 보낼 몸 */
export function sharedBody(c: Course, region: string): SharedBody {
  if (!c.centerline || c.centerline.length < 2 || !c.lengthM) throw new Error('한 번 달려 코스 선이 생긴 뒤에 공개할 수 있어요');
  // 서버는 5000점까지 받는다: 아주 긴·구불구불한 코스는 허용 오차를 키워 맞춘다 (검토 지적: 보내면 알 수 없는 오류였다)
  const line = fitLine(c.centerline, LINE_MAX);
  let tol = SHARE_TOLERANCE_M * 4;
  let thumb = simplifyLine(line, tol);
  while (thumb.length > THUMB_MAX) {
    tol *= 2;
    thumb = simplifyLine(line, tol);
  }
  return { name: c.name, region, kind: c.kind, lengthM: Math.round(c.lengthM), startGate: c.startGate, finishGate: c.finishGate, sectorBoundsM: c.sectorBoundsM, line, thumb };
}

/** 받은 공개 코스 → 폰의 코스 (선은 1 m 로 펴고, 출발선 점을 원점으로) */
export function courseFromShared(
  d: Pick<SharedBody, 'name' | 'kind' | 'lengthM' | 'startGate' | 'finishGate' | 'sectorBoundsM' | 'line'> & { id: string; by: string },
  id: string,
): Course {
  return {
    id,
    name: d.name,
    kind: d.kind,
    source: 'shared',
    origin: { lat: d.startGate.lat, lon: d.startGate.lon },
    startGate: d.startGate,
    finishGate: d.finishGate,
    centerline: expandLine(d.line, 1),
    lengthM: d.lengthM,
    sectorBoundsM: d.sectorBoundsM,
    version: 1,
    shared: { id: d.id, by: d.by },
  };
}
