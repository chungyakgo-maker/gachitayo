// G미터 공용 계산 (사용자 요청): 최대값(1.5·2·2.5·3 g, 기본 2 g)에 맞춘 눈금 원, 최근 궤적을 부드럽게 다듬은 곡선.
// 캔버스(overlay/draw.ts)와 SVG(GMeter) 모두 이것을 쓴다.

export type GPoint = readonly [number, number];

/** 최근 이만큼의 G를 궤적으로 그린다 ms */
export const G_TRAIL_MS = 2000;

/** 고를 수 있는 최대값 (g). 오버레이 그리기는 순수 모듈이라 설정(React)을 부르지 않고 여기 둔다 */
export const G_MAX_OPTIONS = [1.5, 2, 2.5, 3] as const;
export const G_MAX_DEFAULT = 2;

/** 눈금 원 (g, 작은 것부터, 마지막이 최대값). 1.5 g까지는 0.5 g마다, 그 위는 1 g마다 */
export function gRings(max: number): number[] {
  const step = max <= 1.5 ? 0.5 : 1;
  const out: number[] = [];
  for (let g = step; g < max - 1e-9; g += step) out.push(Math.round(g * 10) / 10);
  out.push(max);
  return out;
}

/** G → 원 안 좌표 (−1~1, 오른쪽 +, 아래 +). 왼쪽 G는 왼쪽, 제동(−앞뒤)은 위. 최대값 밖은 원 둘레에 붙인다 */
export function gToUnit(gx: number, gy: number, max: number): GPoint {
  let x = -gy / max;
  let y = gx / max;
  const r = Math.hypot(x, y);
  if (r > 1) {
    x /= r;
    y /= r;
  }
  return [x, y];
}

/** 최근 G 모으기 (스냅숏 시각 순서. 시각이 거꾸로 가면 새로 시작: 재생 다시 시작 등) */
export class GTrailBuffer {
  private buf: Array<{ t: number; gx: number; gy: number }> = [];

  constructor(private readonly spanMs = G_TRAIL_MS) {}

  push(t: number, gx: number | null, gy: number | null): void {
    if (gx === null || gy === null) return;
    const last = this.buf[this.buf.length - 1];
    if (last && t < last.t) this.buf = [];
    else if (last && t === last.t) return;
    this.buf.push({ t, gx, gy });
    while (this.buf.length > 0 && this.buf[0]!.t < t - this.spanMs) this.buf.shift();
  }

  points(): GPoint[] {
    return this.buf.map((p) => [p.gx, p.gy] as const);
  }
}

/** 튀는 값을 누그러뜨리는 3점 이동평균 (양 끝은 그대로: 마지막 점은 지금 점과 이어져야 한다) */
export function smoothTrail(pts: ReadonlyArray<GPoint>): GPoint[] {
  if (pts.length < 3) return pts.slice();
  const out: GPoint[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    out.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

export interface Bezier {
  from: GPoint;
  c1: GPoint;
  c2: GPoint;
  to: GPoint;
}

/** 점들을 지나는 매끈한 곡선 (캣멀롬 → 3차 베지어 조각). 조각 i는 점 i → i+1 */
export function trailBeziers(pts: ReadonlyArray<GPoint>): Bezier[] {
  const out: Bezier[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    out.push({
      from: p1,
      c1: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      c2: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      to: p2,
    });
  }
  return out;
}

/** 궤적 조각의 진하기 (오래된 것부터 옅게) */
export const trailAlpha = (i: number, n: number) => 0.12 + 0.7 * ((i + 1) / Math.max(1, n));

/** G 궤적을 원 안 좌표의 베지어 조각으로 (그릴 것만): 최대값으로 나누고 원 밖은 둘레로, 다듬고, 곡선으로 */
export function gTrailCurves(trail: ReadonlyArray<GPoint> | undefined, max: number): Bezier[] {
  if (!trail || trail.length < 2) return [];
  return trailBeziers(smoothTrail(trail.map(([gx, gy]) => gToUnit(gx, gy, max))));
}
