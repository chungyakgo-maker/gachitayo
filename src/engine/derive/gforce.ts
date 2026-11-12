// G값 (사양서 7.12): 차 기준 ax, ay를 0.2초 이동평균해서 g 단위(9.80665 m/s²)로.
import { config } from '../config';

const G = config.gforce.g;

/** 주행 후: 가운데 기준 0.2초 이동평균 (hz 간격 배열) */
export function smoothG(ax: ArrayLike<number>, ay: ArrayLike<number>, hz: number): { gx: Float64Array; gy: Float64Array } {
  const n = ax.length;
  const half = Math.max(0, Math.round((config.gforce.avgWindowS * hz) / 2));
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  // 값이 없는 칸(보정 전, 모션 끊김: NaN)은 빼고 남은 값으로 평균한다. 창 전체가 비면 NaN
  const cx = new Float64Array(n + 1);
  const cy = new Float64Array(n + 1);
  const cn = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const ok = Number.isFinite(ax[i]!) && Number.isFinite(ay[i]!);
    cx[i + 1] = cx[i]! + (ok ? ax[i]! : 0);
    cy[i + 1] = cy[i]! + (ok ? ay[i]! : 0);
    cn[i + 1] = cn[i]! + (ok ? 1 : 0);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const c = cn[b]! - cn[a]!;
    gx[i] = c > 0 ? (cx[b]! - cx[a]!) / c / G : Number.NaN;
    gy[i] = c > 0 ? (cy[b]! - cy[a]!) / c / G : Number.NaN;
  }
  return { gx, gy };
}

/** 주행 중: 지난 0.2초 평균 */
export class GForceSmoother {
  private buf: Array<{ t: number; ax: number; ay: number }> = [];

  push(tMs: number, ax: number, ay: number): { gx: number; gy: number } {
    this.buf.push({ t: tMs, ax, ay });
    const from = tMs - config.gforce.avgWindowS * 1000;
    while (this.buf.length && this.buf[0]!.t < from) this.buf.shift();
    let sx = 0;
    let sy = 0;
    for (const b of this.buf) {
      sx += b.ax;
      sy += b.ay;
    }
    return { gx: sx / this.buf.length / G, gy: sy / this.buf.length / G };
  }

  reset(): void {
    this.buf = [];
  }
}
