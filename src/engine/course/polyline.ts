// 평면 위 꺾은선 (중심선, 랩 경로). s는 시작부터의 누적 거리.

export interface Polyline {
  x: Float64Array;
  y: Float64Array;
  s: Float64Array;
  length: number;
}

export function makePolyline(xs: ArrayLike<number>, ys: ArrayLike<number>): Polyline {
  const n = xs.length;
  const x = Float64Array.from(xs);
  const y = Float64Array.from(ys);
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!);
  return { x, y, s, length: n ? s[n - 1]! : 0 };
}

/**
 * 경로를 따라 windowM 길이 안의 점들을 평균한다 (이동 평균, 누적합으로 O(n log n)).
 * closed면 시작과 끝이 이어진 것으로 본다 (마지막 점 = 첫 점이어도 된다).
 */
export function smoothPath(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  windowM: number,
  closed = false,
): { x: number[]; y: number[] } {
  const p = makePolyline(xs, ys);
  const n = xs.length;
  if (n === 0) return { x: [], y: [] };
  const half = windowM / 2;
  const L = p.length;
  // 닫힌 경로는 마지막(=첫) 점을 빼고 앞뒤로 한 바퀴씩 이어 붙여 감싼다
  const m = closed && n > 1 ? n - 1 : n;
  const reps = closed ? 3 : 1;
  const S = new Float64Array(m * reps);
  const X = new Float64Array(m * reps);
  const Y = new Float64Array(m * reps);
  for (let r = 0; r < reps; r++)
    for (let i = 0; i < m; i++) {
      const k = r * m + i;
      S[k] = p.s[i]! + (closed ? (r - 1) * L : 0);
      X[k] = p.x[i]!;
      Y[k] = p.y[i]!;
    }
  const cx = new Float64Array(S.length + 1);
  const cy = new Float64Array(S.length + 1);
  for (let k = 0; k < S.length; k++) {
    cx[k + 1] = cx[k]! + X[k]!;
    cy[k + 1] = cy[k]! + Y[k]!;
  }
  const lower = (v: number) => {
    let lo = 0;
    let hi = S.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (S[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const outX: number[] = [];
  const outY: number[] = [];
  for (let i = 0; i < n; i++) {
    const si = p.s[i]!;
    const a = lower(si - half);
    const b = lower(si + half + 1e-12);
    const c = Math.max(1, b - a);
    outX.push((cx[b]! - cx[a]!) / c);
    outY.push((cy[b]! - cy[a]!) / c);
  }
  if (closed && n > 1) {
    outX[n - 1] = outX[0]!;
    outY[n - 1] = outY[0]!;
  }
  return { x: outX, y: outY };
}

/** 균일 간격으로 다시 샘플링 (양 끝점 유지, 간격은 spacingM에 가장 가깝게) */
export function resamplePolyline(p: Polyline, spacingM: number): Polyline {
  const n = Math.max(2, Math.round(p.length / spacingM) + 1);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (p.length * i) / (n - 1);
    while (j < p.s.length - 2 && p.s[j + 1]! < s) j++;
    const seg = p.s[j + 1]! - p.s[j]!;
    const f = seg > 0 ? (s - p.s[j]!) / seg : 0;
    xs[i] = p.x[j]! + (p.x[j + 1]! - p.x[j]!) * f;
    ys[i] = p.y[j]! + (p.y[j + 1]! - p.y[j]!) * f;
  }
  return makePolyline(xs, ys);
}

/** s 위치의 점과 진행 방향 ψ (동쪽 기준 반시계) */
export function polylinePoint(p: Polyline, s: number): { x: number; y: number; psi: number } {
  const n = p.s.length;
  const sc = Math.min(Math.max(s, 0), p.length);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.s[mid]! <= sc) lo = mid;
    else hi = mid;
  }
  const seg = p.s[hi]! - p.s[lo]!;
  const f = seg > 0 ? (sc - p.s[lo]!) / seg : 0;
  return {
    x: p.x[lo]! + (p.x[hi]! - p.x[lo]!) * f,
    y: p.y[lo]! + (p.y[hi]! - p.y[lo]!) * f,
    psi: Math.atan2(p.y[hi]! - p.y[lo]!, p.x[hi]! - p.x[lo]!),
  };
}

/** 점에서 선분 (ax, ay)–(bx, by)까지 가장 가까운 점의 비율(0~1)과 거리 */
export function closestOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { f: number; d: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let f = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  f = Math.min(1, Math.max(0, f));
  return { f, d: Math.hypot(px - (ax + dx * f), py - (ay + dy * f)) };
}

/** 점에서 가장 가까운 꺾은선 위치 s와 거리 (전체 검색) */
export function nearestOnPolyline(p: Polyline, x: number, y: number): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i + 1 < p.s.length; i++) {
    const r = closestOnSegment(x, y, p.x[i]!, p.y[i]!, p.x[i + 1]!, p.y[i + 1]!);
    if (r.d < best.d) best = { s: p.s[i]! + (p.s[i + 1]! - p.s[i]!) * r.f, d: r.d };
  }
  return best;
}

/** [s0, s1] 부분을 spacingM 간격으로 */
export function slicePolyline(p: Polyline, s0: number, s1: number, spacingM: number): Polyline {
  const len = Math.max(0, s1 - s0);
  const n = Math.max(2, Math.round(len / spacingM) + 1);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = polylinePoint(p, s0 + (len * i) / (n - 1));
    xs[i] = q.x;
    ys[i] = q.y;
  }
  return makePolyline(xs, ys);
}

/** 닫힌 꺾은선을 s0에서 시작하도록 돌린다 (끝점 = 시작점) */
export function rotateClosed(p: Polyline, s0: number, spacingM: number): Polyline {
  const L = p.length;
  const n = Math.max(3, Math.round(L / spacingM) + 1);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = polylinePoint(p, (s0 + (L * i) / (n - 1)) % L);
    xs[i] = q.x;
    ys[i] = q.y;
  }
  xs[n - 1] = xs[0]!;
  ys[n - 1] = ys[0]!;
  return makePolyline(xs, ys);
}
