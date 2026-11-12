// 게이트 통과 (사양서 7.7)
// - 연속된 두 융합 위치를 잇는 선분이 게이트 선분과 교차하고, 진행 방향이 게이트 방향과 같으면(내적 > 0) 통과
// - 통과 시각은 그 선분 안에서 선형 보간
// - 같은 게이트를 10초 안에 다시 통과하면 무시
import { config } from '../config';
import type { CourseGeometry, GateSegment } from './geometry';

/** 선분 p0→p1이 게이트를 올바른 방향으로 지나면 p0 기준 비율(0~1), 아니면 null */
export function crossGate(x0: number, y0: number, x1: number, y1: number, g: GateSegment): number | null {
  const mx = x1 - x0;
  const my = y1 - y0;
  if (mx * g.dx + my * g.dy <= 0) return null;
  const ex = g.bx - g.ax;
  const ey = g.by - g.ay;
  const den = mx * ey - my * ex;
  if (Math.abs(den) < 1e-12) return null;
  const wx = g.ax - x0;
  const wy = g.ay - y0;
  const f = (wx * ey - wy * ex) / den;
  const u = (wx * my - wy * mx) / den;
  if (f < 0 || f > 1 || u < 0 || u > 1) return null;
  return f;
}

export interface GateCrossing {
  gate: 'start' | 'finish';
  /** 통과 시각 (세션 시계 ms) */
  t: number;
}

export class GateDetector {
  private prev: { t: number; x: number; y: number } | null = null;
  private readonly lastT = { start: -Infinity, finish: -Infinity };

  constructor(private readonly geom: CourseGeometry) {}

  push(t: number, x: number, y: number): GateCrossing[] {
    const out: GateCrossing[] = [];
    const p = this.prev;
    if (p) {
      const gates: Array<['start' | 'finish', GateSegment]> =
        this.geom.course.kind === 'loop'
          ? [['start', this.geom.start]]
          : [
              ['start', this.geom.start],
              ['finish', this.geom.finish],
            ];
      for (const [name, g] of gates) {
        const f = crossGate(p.x, p.y, x, y, g);
        if (f === null) continue;
        const tc = p.t + f * (t - p.t);
        if (tc - this.lastT[name] < config.course.gateDebounceS * 1000) continue;
        this.lastT[name] = tc;
        out.push({ gate: name, t: tc });
      }
    }
    this.prev = { t, x, y };
    return out;
  }
}
