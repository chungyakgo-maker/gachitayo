// 앞 친구 간격 (사용자 요청, M9): 앞 친구가 "지금 내 자리"를 몇 초 전에 지났는지.
// 앞 친구가 보낸 최근 위치들(GPS 시각, 평면 m)을 선으로 잇고, 내 위치에서 가장 가까운 곳을
// 가장 최근에 지난 시각을 찾아 지금 시각에서 뺀다. 코스가 없어도(와인딩) 된다.
// 같은 곳을 거꾸로 지난 기록(왕복)은 진행 방향이 반대라 쓰지 않는다. 시각은 두 폰 모두 GPS 기준 epoch ms.

export interface TrailPoint {
  /** GPS 기준 epoch ms */
  t: number;
  x: number;
  y: number;
}

export interface GapMe {
  x: number;
  y: number;
  /** 진행 방향 (x축에서 반시계 라디안). 모르면 방향 확인을 건너뛴다 */
  psi?: number;
  /** 이 위치에 있던 시각 (GPS 기준 epoch ms) */
  t: number;
}

/** 앞 친구 경로에서 이만큼 넘게 떨어져 있으면 같은 길이 아니다 */
export const GAP_MAX_LATERAL_M = 25;
/** 앞 친구 위치 사이가 이보다 길게 비면 그 사이는 잇지 않는다 */
const GAP_MAX_SEGMENT_MS = 5000;
/** 진행 방향 차이가 이보다 크면(약 60°) 다른 방향으로 지난 것 */
const MIN_HEADING_COS = 0.5;
/** 앞 친구의 마지막 위치 너머는 마지막 구간 몇 개 길이까지 그 속도로 늘려 계산한다 */
const MAX_EXTRAPOLATE_SEGMENTS = 1.5;
/** 앞 친구의 마지막 위치보다 이 거리 안쪽에서 앞서 있으면 "내가 앞섬"으로 본다 */
const AHEAD_CHECK_M = 300;

/** 앞 친구가 지금 내 자리를 몇 초 전에 지났는지. 찾지 못하면(내가 앞섬, 다른 길) null */
export function gapSeconds(trail: readonly TrailPoint[], me: GapMe): number | null {
  // 1. 앞 친구의 마지막 위치를 막 지났는데 다음 위치가 아직 안 온 경우: 마지막 구간을 그 속도로 늘려 본다.
  //    마지막 위치보다 한참 앞이면 내가 앞선 것 (한 바퀴 전 기록과 헷갈리지 않게 여기서 끝낸다)
  const n = trail.length;
  if (n >= 2) {
    const a = trail[n - 2]!;
    const b = trail[n - 1]!;
    const dt = b.t - a.t;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    if (dt > 0 && dt <= GAP_MAX_SEGMENT_MS && len2 > 1e-6) {
      const u = ((me.x - a.x) * ex + (me.y - a.y) * ey) / len2;
      const headingOk = me.psi === undefined || (ex * Math.cos(me.psi) + ey * Math.sin(me.psi)) / Math.sqrt(len2) >= MIN_HEADING_COS;
      const lateral = Math.abs((me.x - a.x) * ey - (me.y - a.y) * ex) / Math.sqrt(len2);
      if (headingOk && u > 1.05 && lateral <= GAP_MAX_LATERAL_M) {
        const aheadM = (u - 1) * Math.sqrt(len2);
        if (u <= MAX_EXTRAPOLATE_SEGMENTS + 1) {
          const g = (me.t - (b.t + (u - 1) * dt)) / 1000;
          return g < -0.5 ? null : Math.max(0, g);
        }
        if (aheadM <= AHEAD_CHECK_M) return null;
      }
    }
  }

  // 2. 최근 것부터: 가까운 구간이 이어지는 동안만 보고(그 지점을 가장 최근에 지난 것), 끊기면 멈춘다
  let best: { d: number; t: number } | null = null;
  for (let i = trail.length - 1; i > 0; i--) {
    // 잡음이 큰 점 하나가 끼어 있어도 놓치지 않게, 그 점을 건너뛴 구간(i-2 → i)도 본다
    const hit = segmentHit(trail[i - 1]!, trail[i]!, me) ?? (i >= 2 ? segmentHit(trail[i - 2]!, trail[i]!, me) : null);
    if (hit) {
      if (!best || hit.d < best.d) best = hit;
    } else if (best) break;
  }
  if (!best) return null;
  const g = (me.t - best.t) / 1000;
  // 시계가 크게 어긋나 음수가 되면 믿지 않는다
  return g < -0.5 ? null : Math.max(0, g);
}

/** 구간 a→b에서 내 위치와 가장 가까운 곳 (같은 방향, 옆으로 25 m 안). 아니면 null */
function segmentHit(a: TrailPoint, b: TrailPoint, me: GapMe): { d: number; t: number } | null {
  const dt = b.t - a.t;
  if (dt <= 0 || dt > GAP_MAX_SEGMENT_MS) return null;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len2 = ex * ex + ey * ey;
  if (len2 <= 1e-6) return null;
  if (me.psi !== undefined && (ex * Math.cos(me.psi) + ey * Math.sin(me.psi)) / Math.sqrt(len2) < MIN_HEADING_COS) return null;
  const u = ((me.x - a.x) * ex + (me.y - a.y) * ey) / len2;
  if (u < -0.05 || u > 1.05) return null;
  const uc = Math.min(1, Math.max(0, u));
  const d = Math.hypot(me.x - (a.x + uc * ex), me.y - (a.y + uc * ey));
  return d <= GAP_MAX_LATERAL_M ? { d, t: a.t + uc * dt } : null;
}

/** 이보다 오래된 앞 친구 위치는 버린다 */
const TRAIL_KEEP_MS = 180_000;
/** 앞 친구 위치가 이만큼 넘게 안 오면 "신호 없음" */
export const GAP_STALE_MS = 5000;
/** 부드럽게 하는 시간 상수 (초) */
const SMOOTH_S = 1;

/** 받은 앞 친구 위치를 모아 두고, 그릴 때마다 간격을 부드럽게 계산한다 */
export class GapTracker {
  private trail: TrailPoint[] = [];
  private smooth: number | null = null;
  private lastT: number | null = null;

  push(p: TrailPoint): void {
    const last = this.trail[this.trail.length - 1];
    if (last && p.t <= last.t) return; // 늦게 온 것·같은 것
    this.trail.push(p);
    const cut = p.t - TRAIL_KEEP_MS;
    let k = 0;
    while (k < this.trail.length && this.trail[k]!.t < cut) k++;
    if (k > 0) this.trail.splice(0, k);
  }

  /** 좌표계가 바뀌면(코스 원점) 모은 위치를 새 좌표로 */
  reset(points: TrailPoint[] = []): void {
    this.trail = [];
    this.smooth = null;
    this.lastT = null;
    for (const p of points) this.push(p);
  }

  latest(): TrailPoint | null {
    return this.trail[this.trail.length - 1] ?? null;
  }

  update(me: GapMe, nowEpochMs: number): { gapS: number | null; stale: boolean } {
    const last = this.latest();
    const stale = !last || nowEpochMs - last.t > GAP_STALE_MS;
    const raw = stale ? null : gapSeconds(this.trail, me);
    if (raw === null) {
      this.smooth = null;
      this.lastT = null;
      return { gapS: null, stale };
    }
    const dt = this.lastT === null ? Infinity : Math.max(0, (me.t - this.lastT) / 1000);
    this.smooth = this.smooth === null || !Number.isFinite(dt) ? raw : this.smooth + (raw - this.smooth) * Math.min(1, dt / SMOOTH_S);
    this.lastT = me.t;
    return { gapS: this.smooth, stale };
  }
}
