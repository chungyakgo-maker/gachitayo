// 가상 주행용 코스 모양 (사양서 10.1): 타원 서킷, 헤어핀 와인딩 편도, 코스가 가까이 붙은 구간.
// ψ는 동쪽 기준 반시계 각(rad, 펼친 값), 곡률은 왼쪽 회전이 +.

export interface TrackPoint {
  x: number;
  y: number;
  psi: number;
  curvature: number;
}

export interface Track {
  length: number;
  closed: boolean;
  /** 닫힌 코스는 s가 둘레를 넘으면 다음 바퀴로 이어진다 (ψ는 계속 누적) */
  pointAt(s: number): TrackPoint;
}

const DS = 0.25;

function fromSamples(
  s: Float64Array,
  x: Float64Array,
  y: Float64Array,
  psi: Float64Array,
  k: Float64Array,
  closedHint?: boolean,
): Track {
  const n = s.length;
  const length = s[n - 1]!;
  const closed =
    closedHint ?? Math.hypot(x[n - 1]! - x[0]!, y[n - 1]! - y[0]!) < 1;
  const turnPerLap = psi[n - 1]! - psi[0]!;
  const lerp = (a: Float64Array, i: number, f: number) => a[i]! + (a[i + 1]! - a[i]!) * f;
  return {
    length,
    closed,
    pointAt(sq: number): TrackPoint {
      let lap = 0;
      let r = sq;
      if (closed) {
        lap = Math.floor(sq / length);
        r = sq - lap * length;
        if (lap > 0 && r === 0) {
          lap -= 1;
          r = length;
        }
      } else {
        r = Math.min(Math.max(sq, 0), length);
      }
      const fi = r / DS;
      const i = Math.min(Math.floor(fi), n - 2);
      const f = Math.min(fi - i, 1);
      return {
        x: lerp(x, i, f),
        y: lerp(y, i, f),
        psi: lerp(psi, i, f) + lap * turnPerLap,
        curvature: lerp(k, i, f),
      };
    },
  };
}

/** 균일 간격(DS)으로 다시 샘플링 */
function resampleUniform(
  sRaw: number[],
  xRaw: number[],
  yRaw: number[],
  psiRaw: number[],
  kRaw: number[],
  closedHint?: boolean,
): Track {
  const total = sRaw[sRaw.length - 1]!;
  const n = Math.round(total / DS) + 1;
  const s = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const psi = new Float64Array(n);
  const k = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const si = Math.min(i * DS, total);
    while (j < sRaw.length - 2 && sRaw[j + 1]! < si) j++;
    const f = (si - sRaw[j]!) / (sRaw[j + 1]! - sRaw[j]!);
    s[i] = si;
    x[i] = xRaw[j]! + (xRaw[j + 1]! - xRaw[j]!) * f;
    y[i] = yRaw[j]! + (yRaw[j + 1]! - yRaw[j]!) * f;
    psi[i] = psiRaw[j]! + (psiRaw[j + 1]! - psiRaw[j]!) * f;
    k[i] = kRaw[j]! + (kRaw[j + 1]! - kRaw[j]!) * f;
  }
  return fromSamples(s, x, y, psi, k, closedHint);
}

/** 반시계 방향 타원 (a: x 반지름, b: y 반지름). (a, 0)에서 북쪽으로 출발 */
export function ellipseTrack(a: number, b: number): Track {
  const n = 40_000;
  const s: number[] = [0];
  const x: number[] = [];
  const y: number[] = [];
  const psi: number[] = [];
  const k: number[] = [];
  for (let i = 0; i <= n; i++) {
    const th = (2 * Math.PI * i) / n;
    x.push(a * Math.cos(th));
    y.push(b * Math.sin(th));
    psi.push(Math.atan2(b * Math.cos(th), -a * Math.sin(th)));
    k.push((a * b) / (a * a * Math.sin(th) ** 2 + b * b * Math.cos(th) ** 2) ** 1.5);
    if (i > 0) s.push(s[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!));
  }
  // ψ 펼치기
  for (let i = 1; i < psi.length; i++) {
    while (psi[i]! - psi[i - 1]! > Math.PI) psi[i]! -= 2 * Math.PI;
    while (psi[i]! - psi[i - 1]! < -Math.PI) psi[i]! += 2 * Math.PI;
  }
  return resampleUniform(s, x, y, psi, k, true);
}

export type Segment = { straight: number } | { arc: number; angleDeg: number };

/** 직선과 원호를 이어 만든 코스. arc는 반지름(+ 왼쪽, − 오른쪽), angleDeg는 도는 각도 */
export function segmentTrack(segments: Segment[]): Track {
  const s: number[] = [0];
  const x: number[] = [0];
  const y: number[] = [0];
  const psi: number[] = [0];
  const k: number[] = [0];
  for (const seg of segments) {
    const len = 'straight' in seg ? seg.straight : Math.abs(seg.arc) * ((seg.angleDeg * Math.PI) / 180);
    const kappa = 'straight' in seg ? 0 : 1 / seg.arc;
    const steps = Math.max(1, Math.ceil(len / (DS / 4)));
    const ds = len / steps;
    k[k.length - 1] = kappa;
    for (let i = 0; i < steps; i++) {
      const p = psi[psi.length - 1]!;
      const mid = p + (kappa * ds) / 2;
      x.push(x[x.length - 1]! + Math.cos(mid) * ds);
      y.push(y[y.length - 1]! + Math.sin(mid) * ds);
      psi.push(p + kappa * ds);
      k.push(kappa);
      s.push(s[s.length - 1]! + ds);
    }
  }
  return resampleUniform(s, x, y, psi, k);
}

/** 직선 두 개와 반원 두 개로 된 오벌 서킷. 직선 시작점에서 동쪽으로 출발 */
export function stadiumTrack(straight = 400, radius = 80): Track {
  return segmentTrack([
    { straight },
    { arc: radius, angleDeg: 180 },
    { straight },
    { arc: radius, angleDeg: 180 },
  ]);
}

/** 헤어핀이 있는 와인딩 편도 (헤어핀 양쪽 길이 24 m 떨어져 있음) */
export function windingWithHairpins(): Track {
  return segmentTrack([
    { straight: 150 },
    { arc: 40, angleDeg: 60 },
    { straight: 80 },
    { arc: -12, angleDeg: 180 },
    { straight: 120 },
    { arc: 12, angleDeg: 180 },
    { straight: 100 },
    { arc: -30, angleDeg: 90 },
    { arc: 30, angleDeg: 90 },
    { straight: 200 },
  ]);
}

/** 코스가 가까이 붙은 닫힌 코스: 300 m 직선 두 개가 20 m 떨어져 나란히 간다 */
export function closeParallelTrack(): Track {
  return segmentTrack([
    { straight: 300 },
    { arc: 10, angleDeg: 180 },
    { straight: 300 },
    { arc: 10, angleDeg: 180 },
  ]);
}

/**
 * 진입로(편도) 끝에 랩 코스를 붙여 laps 바퀴 도는 경로 (피트에서 출발하는 서킷 흉내).
 * 랩 코스는 진입로 끝 위치·방향에 맞춰 옮겨 놓는다.
 */
export function concatTracks(lead: Track, loop: Track, laps: number): Track & { loopAt: (s: number) => TrackPoint } {
  const e = lead.pointAt(lead.length);
  const s0 = loop.pointAt(0);
  const rot = e.psi - s0.psi;
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  const loopAt = (s: number): TrackPoint => {
    const p = loop.pointAt(s);
    const dx = p.x - s0.x;
    const dy = p.y - s0.y;
    return { x: e.x + c * dx - sn * dy, y: e.y + sn * dx + c * dy, psi: p.psi + rot, curvature: p.curvature };
  };
  return {
    length: lead.length + laps * loop.length,
    closed: false,
    pointAt: (s) => (s <= lead.length ? lead.pointAt(s) : loopAt(s - lead.length)),
    loopAt,
  };
}

/** 같은 길을 거꾸로 */
export function reversedTrack(t: Track): Track {
  return {
    length: t.length,
    closed: t.closed,
    pointAt(s) {
      const p = t.pointAt(t.length - s);
      return { x: p.x, y: p.y, psi: p.psi + Math.PI, curvature: -p.curvature };
    },
  };
}

/** 두 편도를 그대로 잇는다 (b는 이미 a의 끝에서 시작하는 좌표) */
export function joinTracks(a: Track, b: Track): Track {
  return {
    length: a.length + b.length,
    closed: false,
    pointAt: (s) => (s <= a.length ? a.pointAt(s) : b.pointAt(s - a.length)),
  };
}

/** b를 a의 끝 위치·방향에 이어 붙인다 (b를 돌리고 옮긴다) */
export function appendTrack(a: Track, b: Track): Track {
  const e = a.pointAt(a.length);
  const s0 = b.pointAt(0);
  const rot = e.psi - s0.psi;
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  return {
    length: a.length + b.length,
    closed: false,
    pointAt(s) {
      if (s <= a.length) return a.pointAt(s);
      const p = b.pointAt(s - a.length);
      const dx = p.x - s0.x;
      const dy = p.y - s0.y;
      return { x: e.x + c * dx - sn * dy, y: e.y + sn * dx + c * dy, psi: p.psi + rot, curvature: p.curvature };
    },
  };
}

/**
 * 물방울 모양 U턴: 오른쪽 a°, 왼쪽 180+2a°, 오른쪽 a° (반지름 r). 끝나면 방향이 반대이고 왼쪽으로 약간 옮겨져 있다
 * (r 6 m, a 50°면 3.4 m: 반대 차로).
 */
export function uTurn(r = 6, a = 50): Track {
  return segmentTrack([
    { arc: -r, angleDeg: a },
    { arc: r, angleDeg: 180 + 2 * a },
    { arc: -r, angleDeg: a },
  ]);
}

/** 편도를 올라갔다(U턴) 내려와(U턴) 다시 올라가는 경로 */
export function upDownUp(w: Track): Track {
  return appendTrack(appendTrack(appendTrack(appendTrack(w, uTurn()), reversedTrack(w)), uTurn()), w);
}

/**
 * 점들(평면 m, 순서대로)로 만든 열린 코스 (모의주행, 사양서 10.2: 코스 중심선 → 가상 코스).
 * 방향은 구간 방향을 펼친 값. 곡률은 앞뒤 창(기본 20 m)의 방향 차이 ÷ 거리로 구해, 1 m 간격 점의 작은 떨림이 속도를 깎지 않게 한다.
 */
export function polylineTrack(points: ReadonlyArray<readonly [number, number]>, opts: { curvatureWindowM?: number } = {}): Track {
  const h = (opts.curvatureWindowM ?? 20) / 2;
  const P = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1]![0], p[1] - points[i - 1]![1]) > 1e-6);
  if (P.length < 2) throw new Error('코스를 만들려면 점이 2개 이상 있어야 합니다');
  const n = P.length;
  const s: number[] = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1]! + Math.hypot(P[i]![0] - P[i - 1]![0], P[i]![1] - P[i - 1]![1]));
  const psi: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.min(i, n - 2)]!;
    const b = P[Math.min(i, n - 2) + 1]!;
    let v = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (i > 0) {
      const prev = psi[i - 1]!;
      v += Math.round((prev - v) / (2 * Math.PI)) * 2 * Math.PI;
    }
    psi.push(v);
  }
  const L = s[n - 1]!;
  let j = 0;
  const psiAt = (q: number) => {
    const t = Math.min(Math.max(q, 0), L);
    while (j > 0 && s[j]! > t) j--;
    while (j < n - 2 && s[j + 1]! < t) j++;
    const f = (t - s[j]!) / (s[j + 1]! - s[j]! || 1);
    return psi[j]! + (psi[j + 1]! - psi[j]!) * f;
  };
  const k = s.map((si) => {
    const a = Math.max(si - h, 0);
    const b = Math.min(si + h, L);
    return b > a ? (psiAt(b) - psiAt(a)) / (b - a) : 0;
  });
  return resampleUniform(s, P.map((p) => p[0]), P.map((p) => p[1]), psi, k, false);
}
