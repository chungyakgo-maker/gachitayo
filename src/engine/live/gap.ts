// 앞 친구 간격 (사용자 요청, M9): 앞 친구가 "지금 내 자리"를 몇 초 전에 지났는지.
// 앞 친구가 보낸 최근 위치들(GPS 시각, 평면 m)을 선으로 잇고, 내 위치에서 가장 가까운 곳을
// 가장 최근에 지난 시각을 찾아 지금 시각에서 뺀다. 코스가 없어도(와인딩) 된다.
// 같은 곳을 거꾸로 지난 기록(왕복)은 진행 방향이 반대라 쓰지 않는다. 시각은 두 폰 모두 GPS 기준 epoch ms.

export interface TrailPoint {
  /** GPS 기준 epoch ms */
  t: number;
  x: number;
  y: number;
  /** GPS 속도 m/s (앞 친구가 보낸 값. 모르면 없음) */
  v?: number | null;
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

/** 속도 비율을 쓰는 최소 속도 m/s, 비율 상한 (GPS 잡음·정차 때 튀지 않게) */
const MIN_RATIO_SPEED = 3;
const MAX_SPEED_RATIO = 1.4;

/** 친구 최근 위치가 가까운데 이보다 오래전 통과를 고르면 한 바퀴 전 기록으로 본다 */
const OLD_PASS_MS = 20_000;

/** 내 최근 경로에서 이 시간 안의 통과만 본다 (한 바퀴 전과 헷갈리지 않게) */
const MINE_WINDOW_MS = 30_000;

/**
 * 앞 친구가 지금 내 자리를 몇 초 전에 지났는지. 찾지 못하면(내가 앞섬, 다른 길) null.
 * mine: 내 최근 위치들 (오래된 것부터, 지금 위치 me는 빼고). 있으면 0단계를 쓴다.
 */
export function gapSeconds(trail: readonly TrailPoint[], me: GapMe, mine: readonly TrailPoint[] = []): number | null {
  // 0. 앞 친구의 최신 위치를 내가 이미 지났으면 (간격이 짧아 친구 위치가 아직 내 자리까지 안 옴):
  //    내가 그 점을 지난 시각 − 친구가 그 점을 지난 시각. 직선으로 늘려 짐작하지 않아 코너에서도 맞다.
  //    그 점에서의 간격이라 친구 위치가 늦게 온 만큼(보통 1~2초) 늦은 값이다 (실측 평가, 사용자 문의 "델타 딜레이")
  const n = trail.length;
  if (n >= 1 && mine.length >= 1) {
    const path: TrailPoint[] = [...mine.filter((q) => q.t >= me.t - MINE_WINDOW_MS), { t: me.t, x: me.x, y: me.y }];
    // 친구의 최신 점이 튄 값이면 그 앞 점으로 (최근 3개까지)
    for (let j = n - 1; j >= Math.max(0, n - 3); j--) {
      if (isOutlier(trail, j)) continue;
      const g = passedGap(path, trail, j);
      if (g === 'not_passed') break;
      if (g !== null) return g < -0.5 ? null : Math.max(0, g);
    }
  }

  // 1. (내 경로가 아직 없을 때) 앞 친구의 마지막 위치를 막 지났는데 다음 위치가 아직 안 온 경우: 마지막 구간을 그 속도로 늘려 본다.
  //    마지막 위치보다 한참 앞이면 내가 앞선 것 (한 바퀴 전 기록과 헷갈리지 않게 여기서 끝낸다)
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
  // 친구의 최근 위치가 바로 옆(300 m 안)인데 20초 넘게 전 통과를 골랐으면 한 바퀴 전 기록이다 (친구 위치가 늦게 와서 아직 없음)
  const newest = trail[trail.length - 1]!;
  if (newest.t - best.t > OLD_PASS_MS && trail.slice(-3).some((q) => Math.hypot(q.x - me.x, q.y - me.y) <= AHEAD_CHECK_M)) return null;
  const g = (me.t - best.t) / 1000;
  // 시계가 크게 어긋나 음수가 되면 믿지 않는다
  return g < -0.5 ? null : Math.max(0, g);
}

/** 이보다 빠르게 움직인 것처럼 보이면 튄 점이다 (m/s) */
const MAX_PLAUSIBLE_SPEED_MPS = 80;

/** 튄 점: 앞뒤 점(마지막 점이면 그 앞 두 점)으로 예상한 자리에서 이만큼 넘게 벗어남 (m) */
const OUTLIER_M = 30;

/**
 * 친구 점 j가 튄 점인지: 주변 점 두 개로 그 시각의 자리를 예상한다 (앞뒤 사이, 앞의 두 점으로 늘림 등).
 * 예상이 하나라도 30 m 안에 맞으면 정상 (예상에 쓴 점이 튄 점일 수도 있어서, 모두 어긋날 때만 튄 점)
 */
export function isOutlier(trail: readonly TrailPoint[], j: number): boolean {
  const b = trail[j]!;
  const pairs: Array<[number, number]> = [
    [j - 1, j + 1],
    [j - 2, j - 1],
    [j + 1, j + 2],
    [j - 3, j - 2],
    [j - 2, j + 1],
    [j - 1, j + 2],
  ];
  let tried = 0;
  for (const [i0, i1] of pairs) {
    const p = trail[i0];
    const q = trail[i1];
    if (!p || !q) continue;
    const span = q.t - p.t;
    if (span <= 0 || Math.abs(b.t - p.t) > 2 * GAP_MAX_SEGMENT_MS || Math.abs(b.t - q.t) > 2 * GAP_MAX_SEGMENT_MS) continue;
    tried++;
    const u = (b.t - p.t) / span;
    if (Math.hypot(b.x - (p.x + (q.x - p.x) * u), b.y - (p.y + (q.y - p.y) * u)) <= OUTLIER_M) return false;
  }
  return tried > 0;
}

/** 친구 점 j에서의 진행 방향 (단위 벡터). 앞뒤 점 중 튄 점이 아닌 것과 잇는다. 모르면 null */
function friendDir(trail: readonly TrailPoint[], j: number): [number, number] | null {
  const b = trail[j]!;
  const ok = (p: TrailPoint | undefined) => {
    if (!p) return false;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    const dt = Math.abs(p.t - b.t) / 1000;
    return dt > 0 && dt <= GAP_MAX_SEGMENT_MS / 1000 && d > 0.5 && d / dt <= MAX_PLAUSIBLE_SPEED_MPS;
  };
  for (const k of [j - 1, j - 2, j + 1, j + 2]) {
    const p = trail[k];
    if (!ok(p) || isOutlier(trail, k)) continue;
    const sgn = k < j ? 1 : -1;
    const vx = (b.x - p!.x) * sgn;
    const vy = (b.y - p!.y) * sgn;
    const l = Math.hypot(vx, vy);
    return [vx / l, vy / l];
  }
  return null;
}

/** 내가 지난 시각을 맞출 때 앞뒤로 보는 시간 (잡음이 있어도 방향·속도가 안정되게) */
const PASS_BASE_MS = 500;

/**
 * 친구 점 trail[j]를 내가 이미 지났으면 그때의 간격(초). 내 경로가 그 점을 안 지났으면 'not_passed'
 * (아직 그 점에 못 왔거나 정확히 그 위에 있음), 내 경로와 멀면(튄 점, 다른 길) null.
 */
function passedGap(path: readonly TrailPoint[], trail: readonly TrailPoint[], j: number): number | null | 'not_passed' {
  const b = trail[j]!;
  let k = -1;
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.hypot(path[i]!.x - b.x, path[i]!.y - b.y);
    if (d < best) {
      best = d;
      k = i;
    }
  }
  if (k < 0 || best > GAP_MAX_LATERAL_M) return null;
  const last = path.length - 1;
  if (k === last) return 'not_passed';
  // 그 점 앞뒤 0.5초로 내 진행 방향과 속도
  let i0 = k;
  while (i0 > 0 && path[i0 - 1]!.t >= path[k]!.t - PASS_BASE_MS) i0--;
  let i1 = k;
  while (i1 < last && path[i1 + 1]!.t <= path[k]!.t + PASS_BASE_MS) i1++;
  const p0 = path[i0]!;
  const p1 = path[i1]!;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const L = Math.hypot(dx, dy);
  const dt = p1.t - p0.t;
  let tPass = path[k]!.t;
  if (L >= 1 && dt > 0) {
    // 같은 방향으로 지났는지 (친구 진행 방향. 튄 점과 이은 방향은 쓰지 않는다)
    const fdir = friendDir(trail, j);
    if (fdir && (fdir[0] * dx + fdir[1] * dy) / L < MIN_HEADING_COS) return null;
    // 내 위치가 아직 그 점 뒤면 안 지난 것
    const meNow = path[last]!;
    if (((meNow.x - b.x) * dx + (meNow.y - b.y) * dy) / L <= 0) return 'not_passed';
    const along = ((b.x - path[k]!.x) * dx + (b.y - path[k]!.y) * dy) / L;
    tPass += (along / L) * dt;
    // 그 점에서의 간격을 "지금"으로 옮긴다 (사용자 요청 "최대한 예민하게"): 친구가 그 점 뒤에도 그때의 속도 비율로
    // 같은 길을 달린다고 보고, 내가 그 점에서 지금 자리까지 온 시간을 친구 속도로 바꿔 뺀다.
    // 친구가 나보다 느리면 간격이 줄고, 빠르면 는다. 친구 GPS 속도가 없으면 같은 속도로 본다
    const vMe = (L / dt) * 1000;
    const vF = b.v;
    if (vF !== undefined && vF !== null && Number.isFinite(vF) && vF > MIN_RATIO_SPEED && vMe > MIN_RATIO_SPEED) {
      const ratio = Math.max(1 / MAX_SPEED_RATIO, Math.min(MAX_SPEED_RATIO, vMe / vF));
      const dMe = (meNow.t - tPass) / 1000;
      return (tPass - b.t) / 1000 + dMe * (1 - ratio);
    }
  }
  return (tPass - b.t) / 1000;
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
const SMOOTH_S = 0.15;

/** 받은 앞 친구 위치를 모아 두고, 그릴 때마다 간격을 부드럽게 계산한다 */
export class GapTracker {
  constructor(private readonly smoothS = SMOOTH_S) {}

  private trail: TrailPoint[] = [];
  /** 내 최근 위치 (0단계용) */
  private mine: TrailPoint[] = [];
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
    this.mine = [];
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
    const raw = stale ? null : gapSeconds(this.trail, me, this.mine);
    const lastMine = this.mine[this.mine.length - 1];
    if (!lastMine || me.t > lastMine.t) {
      this.mine.push({ t: me.t, x: me.x, y: me.y });
      let k = 0;
      while (k < this.mine.length && this.mine[k]!.t < me.t - MINE_WINDOW_MS) k++;
      if (k > 0) this.mine.splice(0, k);
    }
    if (raw === null) {
      this.smooth = null;
      this.lastT = null;
      return { gapS: null, stale };
    }
    const dt = this.lastT === null ? Infinity : Math.max(0, (me.t - this.lastT) / 1000);
    this.smooth = this.smooth === null || !Number.isFinite(dt) ? raw : this.smooth + (raw - this.smooth) * Math.min(1, dt / this.smoothS);
    this.lastT = me.t;
    return { gapS: this.smooth, stale };
  }
}
