// 브라우저 센서 값 → 내부 샘플 (사양서 6.2, 6.3).
// 브라우저 타입에 의존하지 않도록 필요한 모양만 받는다.
import type { GpsSample, RawMotionSample } from '../types/samples';

/** GeolocationPosition과 같은 모양 */
export interface PositionLike {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;
    altitudeAccuracy: number | null;
    speed: number | null;
    heading: number | null;
  };
}

/** DeviceMotionEvent와 같은 모양 */
export interface MotionLike {
  accelerationIncludingGravity: { x: number | null; y: number | null; z: number | null } | null;
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null } | null;
}

const DEG_TO_RAD = Math.PI / 180;

const finiteOrNull = (v: number | null): number | null =>
  v === null || !Number.isFinite(v) ? null : v;

export function toGpsSample(pos: PositionLike, tRecv: number): GpsSample {
  const c = pos.coords;
  const speed = finiteOrNull(c.speed);
  return {
    tRecv,
    tFix: pos.timestamp,
    lat: c.latitude,
    lon: c.longitude,
    alt: finiteOrNull(c.altitude),
    altAcc: finiteOrNull(c.altitudeAccuracy),
    hAcc: c.accuracy,
    // 일부 기기는 속도를 모를 때 음수를 준다
    speed: speed !== null && speed < 0 ? null : speed,
    // 정지 중에는 방향이 NaN으로 온다
    heading: finiteOrNull(c.heading),
  };
}

const degToRadOrNull = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v * DEG_TO_RAD;

/**
 * 회전 속도 축 대응 (W3C DeviceOrientation): alpha는 기기 z축, beta는 x축, gamma는 y축 회전.
 * 중력 포함 가속도가 없으면 쓸 수 없는 이벤트라 null을 돌려준다.
 */
export function toRawMotionSample(ev: MotionLike, t: number): RawMotionSample | null {
  const g = ev.accelerationIncludingGravity;
  if (!g) return null;
  const { x, y, z } = g;
  if (x === null || y === null || z === null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const r = ev.rotationRate;
  return {
    t,
    gax: x,
    gay: y,
    gaz: z,
    rx: degToRadOrNull(r?.beta),
    ry: degToRadOrNull(r?.gamma),
    rz: degToRadOrNull(r?.alpha),
  };
}
