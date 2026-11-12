// G값 (사양서 7.12): 차 기준 ax, ay를 0.2초 이동평균해서 g 단위(9.80665 m/s²)로.
import { config } from '../config';

const G = config.gforce.g;

/** 주행 후: 가운데 기준 0.2초 이동평균 (hz 간격 배열) */
export function smoothG(ax: ArrayLike<number>, ay: ArrayLike<number>, hz: number): { gx: Float64Array; gy: Float64Array } {
  const n = ax.length;
  const half = Math.max(0, Math.round((config.gforce.avgWindowS * hz) / 2));
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  const cx = new Float64Array(n + 1);
  const cy = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    cx[i + 1] = cx[i]! + ax[i]!;
    cy[i + 1] = cy[i]! + ay[i]!;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    gx[i] = (cx[b]! - cx[a]!) / (b - a) / G;
    gy[i] = (cy[b]! - cy[a]!) / (b - a) / G;
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
