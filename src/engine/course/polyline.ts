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
 * 경로를 따라 windowM 길이 안의 점들을 평균한다 (이동 평균).
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
  const half = windowM / 2;
  const L = p.length;
  const outX: number[] = [];
  const outY: number[] = [];
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let j = 0; j < n; j++) {
      let d = Math.abs(p.s[j]! - p.s[i]!);
      if (closed) d = Math.min(d, L - d);
      if (d <= half) {
        sx += p.x[j]!;
        sy += p.y[j]!;
        c++;
      }
    }
    outX.push(sx / c);
    outY.push(sy / c);
  }
  if (closed && n > 1) {
    // 닫힌 경로는 끝점을 첫 점과 같게 둔다
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
