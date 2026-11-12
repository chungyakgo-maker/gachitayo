// 고도 (사양서 7.13): GPS 고도에서 altAcc가 큰 점을 빼고 평활한다. 참고용 (폰 GPS 고도는 오차가 크다).
import { config } from '../config';
import type { GpsSample } from '../../types/samples';

/** 주어진 시각들(세션 시계 ms)의 평활 고도. 쓸 수 있는 고도가 2개 미만이면 null */
export function smoothAltitude(gps: GpsSample[], times: ArrayLike<number>): Float64Array | null {
  const pts = gps
    .filter((g) => g.alt !== null && (g.altAcc === null || g.altAcc <= config.altitude.maxAltAccM))
    .map((g) => ({ t: g.tRecv, a: g.alt! }))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  const half = (config.altitude.smoothWindowS * 1000) / 2;
  // 점마다 창 평균
  const sm = pts.map((p) => {
    let s = 0;
    let c = 0;
    for (const q of pts) {
      if (Math.abs(q.t - p.t) <= half) {
        s += q.a;
        c++;
      }
    }
    return { t: p.t, a: s / c };
  });
  const out = new Float64Array(times.length);
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    while (j < sm.length - 2 && sm[j + 1]!.t < t) j++;
    const a = sm[j]!;
    const b = sm[j + 1]!;
    const f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)));
    out[i] = a.a + (b.a - a.a) * f;
  }
  return out;
}
