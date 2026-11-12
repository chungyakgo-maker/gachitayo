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
  // 속도가 없는 점: 앞뒤 점의 위치 차이로 계산 (끝점은 한쪽만)
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i]!;
    if (o.speed !== null) continue;
    const a = obs[Math.max(0, i - 1)]!;
    const b = obs[Math.min(obs.length - 1, i + 1)]!;
    const dt = (b.t - a.t) / 1000;
    o.speed = dt > 0 ? Math.hypot(b.x - a.x, b.y - a.y) / dt : 0;
    o.speedDerived = true;
  }
  return obs;
}
