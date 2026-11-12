// 모션 50 Hz 재샘플링 (사양서 6.3): 이벤트 간격이 기기마다 다르므로 선형 보간으로 맞춘다.
// 플랫폼 축 부호(accel, gyro)도 여기서 곱한다.
import { config } from '../engine/config';
import type { RawMotionSample } from '../types/samples';

export interface AxisSigns {
  accel: 1 | -1;
  gyro: 1 | -1;
}

export interface Motion50 {
  /** 첫 격자 시각 (세션 시계 ms, dt의 배수) */
  t0: number;
  /** 격자 간격 ms */
  dt: number;
  n: number;
  /** 중력 포함 가속도 m/s² (기기 축, 부호 적용) */
  fx: Float64Array;
  fy: Float64Array;
  fz: Float64Array;
  /** 회전 속도 rad/s (기기 축, 부호 적용). 자이로가 없으면 0 */
  wx: Float64Array;
  wy: Float64Array;
  wz: Float64Array;
  /** 1이면 유효, 0이면 빈 구간 */
  valid: Uint8Array;
  /** 1이면 회전 속도도 유효 (앞뒤 샘플 모두 회전 값이 있음) */
  gyroValid: Uint8Array;
  /** 회전 값이 있는 샘플이 절반 이상이면 자이로가 있는 기기로 본다 */
  hasGyro: boolean;
}

export function resampleMotion(
  samples: RawMotionSample[],
  signs: AxisSigns = { accel: 1, gyro: 1 },
): Motion50 {
  const dt = 1000 / config.motion.resampleHz;
  const empty = (n: number) => new Float64Array(n);
  if (samples.length === 0) {
    return { t0: 0, dt, n: 0, fx: empty(0), fy: empty(0), fz: empty(0), wx: empty(0), wy: empty(0), wz: empty(0), valid: new Uint8Array(0), gyroValid: new Uint8Array(0), hasGyro: false };
  }
  const s = [...samples].sort((a, b) => a.t - b.t);
  const t0 = Math.ceil(s[0]!.t / dt) * dt;
  const n = Math.max(0, Math.floor((s[s.length - 1]!.t - t0) / dt) + 1);
  const gyroOk = (m: RawMotionSample) => m.rx !== null && m.ry !== null && m.rz !== null;
  // 회전 값이 가끔 빠지는 기기도 있으므로 샘플 하나하나로 판단한다
  const hasGyro = s.filter(gyroOk).length >= s.length / 2;
  const out: Motion50 = { t0, dt, n, fx: empty(n), fy: empty(n), fz: empty(n), wx: empty(n), wy: empty(n), wz: empty(n), valid: new Uint8Array(n), gyroValid: new Uint8Array(n), hasGyro };
  const sa = signs.accel;
  const sg = signs.gyro;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    while (j < s.length - 2 && s[j + 1]!.t < t) j++;
    const a = s[j]!;
    const b = s[Math.min(j + 1, s.length - 1)]!;
    if (b.t - a.t > config.motion.maxGapMs || t < a.t || t > b.t) continue;
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    const lerp = (p: number, q: number) => p + (q - p) * f;
    out.fx[i] = sa * lerp(a.gax, b.gax);
    out.fy[i] = sa * lerp(a.gay, b.gay);
    out.fz[i] = sa * lerp(a.gaz, b.gaz);
    if (gyroOk(a) && gyroOk(b)) {
      out.wx[i] = sg * lerp(a.rx!, b.rx!);
      out.wy[i] = sg * lerp(a.ry!, b.ry!);
      out.wz[i] = sg * lerp(a.rz!, b.rz!);
      out.gyroValid[i] = 1;
    }
    out.valid[i] = 1;
  }
  return out;
}
