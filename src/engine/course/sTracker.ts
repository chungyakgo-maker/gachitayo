// 위치 → 코스 거리 s (사양서 7.6)
// - 중심선에서 가장 가까운 점. 검색 범위는 [s_prev − 20 m, s_prev + max(50 m, 3·v·dt)]
//   (헤어핀처럼 코스가 가까이 붙은 곳에서 옆 구간으로 튀지 않게)
// - 횡거리 30 m 초과면 코스 이탈: s 갱신을 멈춘다. 이탈 중에는 전체를 검색해 돌아오는 곳을 찾는다.
// - 출발 게이트를 지나면 resetAtStart()로 0에서 다시 시작한다.
import { config } from '../config';
import type { CourseGeometry } from './geometry';
import { closestOnSegment } from './polyline';

const cfg = config.course;

export interface STrack {
  /** 코스 거리 m (중심선이 없으면 null) */
  s: number | null;
  /** 중심선과의 횡거리 m */
  lateral: number;
  onCourse: boolean;
}

export class STracker {
  private sPrev: number | null = null;
  private tPrev: number | null = null;
  private off = false;

  constructor(private readonly geom: CourseGeometry) {}

  resetAtStart(): void {
    this.sPrev = 0;
    this.off = false;
  }

  update(x: number, y: number, v: number, tMs: number): STrack {
    const cl = this.geom.centerline;
    if (!cl) return { s: null, lateral: Number.NaN, onCourse: true };
    const loop = this.geom.course.kind === 'loop';
    const L = cl.length;
    const dt = this.tPrev === null ? 0 : Math.max(0, (tMs - this.tPrev) / 1000);
    this.tPrev = tMs;

    let best: { s: number; d: number };
    if (this.sPrev === null || this.off) {
      best = this.search(x, y, 0, L, false);
    } else {
      const lo = this.sPrev - cfg.sBackWindowM;
      const hi = this.sPrev + Math.max(cfg.sFwdWindowMinM, cfg.sFwdWindowSpeedFactor * v * dt);
      best = this.search(x, y, lo, hi, loop);
    }
    if (best.d > cfg.offCourseLateralM) {
      this.off = true;
      return { s: this.sPrev, lateral: best.d, onCourse: false };
    }
    this.off = false;
    this.sPrev = best.s;
    return { s: best.s, lateral: best.d, onCourse: true };
  }

  /** [lo, hi] 범위의 중심선 선분에서 가장 가까운 점. 랩 코스는 범위를 둘레로 감는다 */
  private search(x: number, y: number, lo: number, hi: number, wrap: boolean): { s: number; d: number } {
    const cl = this.geom.centerline!;
    const n = cl.s.length;
    const L = cl.length;
    const step = L / (n - 1);
    let bestS = 0;
    let bestD = Infinity;
    const ref = this.sPrev;
    // 랩 코스에서 s는 [0, L)로 둔다 (둘레 끝 = 출발선 = 0)
    const norm = (v: number) => (wrap && v >= L - 1e-9 ? v - L : v);
    const far = (v: number) => {
      if (ref === null) return v;
      const d = Math.abs(v - ref);
      return wrap ? Math.min(d, L - d) : d;
    };
    const visit = (i: number) => {
      const r = closestOnSegment(x, y, cl.x[i]!, cl.y[i]!, cl.x[i + 1]!, cl.y[i + 1]!);
      const sv = norm(cl.s[i]! + (cl.s[i + 1]! - cl.s[i]!) * r.f);
      // 거리가 같으면(출발선처럼 같은 점이 두 번 나오는 곳) 이전 s에 가까운 쪽을 고른다
      if (r.d < bestD - 1e-9 || (Math.abs(r.d - bestD) <= 1e-9 && far(sv) < far(bestS))) {
        bestD = r.d;
        bestS = sv;
      }
    };
    if (!wrap) {
      const ia = Math.max(0, Math.floor(Math.max(lo, 0) / step) - 1);
      const ib = Math.min(n - 2, Math.ceil(Math.min(hi, L) / step) + 1);
      for (let i = ia; i <= ib; i++) visit(i);
    } else {
      const ia = Math.floor(lo / step) - 1;
      const ib = Math.ceil(hi / step) + 1;
      for (let k = ia; k <= ib; k++) visit((((k % (n - 1)) + (n - 1)) % (n - 1)));
    }
    return { s: bestS, d: bestD };
  }
}
