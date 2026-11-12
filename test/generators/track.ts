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
