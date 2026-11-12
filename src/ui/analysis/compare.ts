// 분석 화면 계산 (사양서 8.6): 두 랩 비교 그래프 데이터(가로축 코스 거리), 지점 찾기, 속도 색.
// 그래프는 비교용 축약 데이터(trace), 지도·지점 정보·G 다이어그램은 처리된 궤적을 쓴다.
import type { LapTrace } from '../../engine/delta/trace';
import type { ProcessedTrack } from '../../engine/process/processDrive';

export interface CompareSeries {
  /** 코스 거리 m */
  x: number[];
  /** km/h */
  speedA: Array<number | null>;
  speedB: Array<number | null>;
  /** A의 시각 − B의 시각 (초, A가 느리면 +) */
  delta: Array<number | null>;
  /** m */
  altA: Array<number | null>;
}

export function compareSeries(a: LapTrace, b: LapTrace | null): CompareSeries {
  const n = a.t.length;
  const x: number[] = [];
  const speedA: Array<number | null> = [];
  const speedB: Array<number | null> = [];
  const delta: Array<number | null> = [];
  const altA: Array<number | null> = [];
  for (let i = 0; i < n; i++) {
    x.push(i * a.stepM);
    speedA.push(a.v[i]! * 3.6);
    const inB = b !== null && i < b.t.length && b.stepM === a.stepM;
    speedB.push(inB ? b!.v[i]! * 3.6 : null);
    delta.push(inB ? a.t[i]! - b!.t[i]! : null);
    altA.push(a.alt[i] ?? null);
  }
  return { x, speedA, speedB, delta, altA };
}

/** 랩 lapNo 안에서 코스 거리 s에 가장 가까운 처리된 궤적 점 (없으면 null) */
export function lapPointAt(p: ProcessedTrack, lapNo: number, s: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let k = 0; k < p.n; k++) {
    const sk = p.s[k];
    if (p.lapNo[k] !== lapNo || sk === null || sk === undefined) continue;
    const d = Math.abs(sk - s);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** 지도에서 누른 곳에 가장 가까운 랩 lapNo의 점 */
export function nearestLapPoint(p: ProcessedTrack, lapNo: number, lat: number, lon: number): number | null {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best: number | null = null;
  let bestD = Infinity;
  for (let k = 0; k < p.n; k++) {
    if (p.lapNo[k] !== lapNo) continue;
    const dy = p.lat[k]! - lat;
    const dx = (p.lon[k]! - lon) * kx;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** 속도 색칠: 느림 파랑(220°) → 초록 → 노랑 → 빠름 빨강(0°) */
export function speedColor(v: number, vMin: number, vMax: number): string {
  const f = vMax > vMin ? Math.min(1, Math.max(0, (v - vMin) / (vMax - vMin))) : 0.5;
  return `hsl(${Math.round(220 * (1 - f))}, 85%, 55%)`;
}
