// GPS 샘플 → 융합용 관측: 평면 좌표, 속도(없으면 위치 차이로 계산), 진행 방향 ψ.
import { toLocal, type LatLon } from '../geo';
import { wrapAngle } from '../linalg';
import type { GpsSample } from '../../types/samples';

export interface GpsObs {
  /** 수신 시각 tRecv (세션 시계 ms). 융합은 수신 시각을 기준으로 한다 (사양서 6.1) */
  t: number;
  x: number;
  y: number;
  hAcc: number;
  /** m/s */
  speed: number | null;
  /** 속도를 위치 차이로 계산했는지 (속도 품질 낮음, 사양서 6.3) */
  speedDerived: boolean;
  /** 동쪽 기준 반시계 rad. 방향 값이 없으면 null */
  psi: number | null;
}

/** 나침반 방향(북 0°, 시계 방향, 도) → ψ(동 0, 반시계, rad) */
export function gpsPsiFromHeading(deg: number): number {
  return wrapAngle(((90 - deg) * Math.PI) / 180);
}

export function prepareGps(gps: GpsSample[], origin: LatLon): GpsObs[] {
  const sorted = [...gps].sort((a, b) => a.tRecv - b.tRecv);
  const obs: GpsObs[] = sorted.map((g) => {
    const p = toLocal(origin, g.lat, g.lon);
    return {
      t: g.tRecv,
      x: p.x,
      y: p.y,
      hAcc: g.hAcc,
      speed: g.speed,
      speedDerived: false,
      psi: g.heading === null ? null : gpsPsiFromHeading(g.heading),
    };
  });
  // 속도가 없는 점: 앞뒤 2점씩(약 4초) 떨어진 위치 차이로 계산 (끝점은 한쪽만). 잡음을 줄이기 위해 간격을 넓힌다
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i]!;
    if (o.speed !== null) continue;
    const a = obs[Math.max(0, i - 2)]!;
    const b = obs[Math.min(obs.length - 1, i + 2)]!;
    const dt = (b.t - a.t) / 1000;
    o.speed = dt > 0 ? Math.hypot(b.x - a.x, b.y - a.y) / dt : 0;
    o.speedDerived = true;
  }
  return obs;
}

/**
 * 주행 중 GPS 관측: 한 점씩 변환한다. 속도 값이 없는 점은 뒤쪽 2점(약 2초) 전 위치와의 차이로 속도를 계산한다
 * (주행 후 처리는 앞뒤 2점씩을 쓰지만 주행 중에는 미래 점이 없다).
 */
export class LiveGpsObs {
  private readonly recent: GpsObs[] = [];

  constructor(readonly origin: LatLon) {}

  push(g: GpsSample): GpsObs {
    const p = toLocal(this.origin, g.lat, g.lon);
    const o: GpsObs = {
      t: g.tRecv,
      x: p.x,
      y: p.y,
      hAcc: g.hAcc,
      speed: g.speed,
      speedDerived: false,
      psi: g.heading === null ? null : gpsPsiFromHeading(g.heading),
    };
    if (o.speed === null) {
      const a = this.recent[Math.max(0, this.recent.length - 2)];
      const dt = a ? (o.t - a.t) / 1000 : 0;
      o.speed = a && dt > 0 ? Math.hypot(o.x - a.x, o.y - a.y) / dt : 0;
      o.speedDerived = true;
    }
    this.recent.push(o);
    if (this.recent.length > 2) this.recent.shift();
    return o;
  }
}

/** 진행 방향을 구하는 데 필요한 최소 이동 거리 (이보다 짧으면 위치 잡음이 방향을 정해 버린다) */
const MIN_STEP_FOR_HEADING_M = 2;

function yawFrom(a: GpsObs, c: GpsObs, b: GpsObs): number | null {
  const span = (b.t - a.t) / 1000;
  if (span <= 0) return null;
  if (a.psi !== null && b.psi !== null) return wrapAngle(b.psi - a.psi) / span;
  if (Math.hypot(c.x - a.x, c.y - a.y) < MIN_STEP_FOR_HEADING_M) return null;
  if (Math.hypot(b.x - c.x, b.y - c.y) < MIN_STEP_FOR_HEADING_M) return null;
  const p1 = Math.atan2(c.y - a.y, c.x - a.x);
  const p2 = Math.atan2(b.y - c.y, b.x - c.x);
  return wrapAngle(p2 - p1) / span / 0.5;
}

/**
 * GPS로 구한 진행 방향 변화율 (rad/s, 좌회전 +). 가운데 점 k와 앞뒤 점을 쓴다.
 * GPS 방향 값이 있으면 그 차이로, 없으면 위치로 계산한다. 자이로 부호·유무와 무관하다.
 */
export function gpsYawRateAt(gps: GpsObs[], k: number, maxSpanMs: number): number | null {
  const a = gps[k - 1];
  const c = gps[k];
  const b = gps[k + 1];
  if (!a || !b || !c || b.t - a.t > maxSpanMs) return null;
  return yawFrom(a, c, b);
}

/** 실시간용: 마지막 점 n과 그 앞 점들로 구한 진행 방향 변화율 */
export function gpsYawRateBackward(gps: GpsObs[], n: number, maxSpanMs: number): number | null {
  const a = gps[n - 2];
  const c = gps[n - 1];
  const b = gps[n];
  if (!a || !b || !c || b.t - a.t > maxSpanMs) return null;
  return yawFrom(a, c, b);
}
