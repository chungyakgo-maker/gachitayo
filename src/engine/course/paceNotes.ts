// 커브 표지판 (사양서 8.4, 사용자 요청 "랠리 페이스노트처럼 몇 m 앞 왼쪽 3"): 코스 선에서 커브를 자동으로 찾아 방향·등급·붙는 말을 정하고,
// 주행 중에는 지금 코스 위치로 다음 커브와 남은 거리를 고른다. 공식 표준이 없어 등급은 반지름으로 우리 기준을 정했다(기본 코스 11개 분포).
import type { Polyline } from './polyline';
import { polylinePoint } from './polyline';

export type PaceGrade = 1 | 2 | 3 | 4 | 5 | 6 | 'H' | 'S';
export type PaceMod = '조여짐' | '풀림' | '길게' | null;

export interface PaceNote {
  /** 커브가 시작하는 코스 위치 (m) */
  s0: number;
  /** 커브가 끝나는 코스 위치 (m) */
  s1: number;
  dir: 'left' | 'right';
  /** 1(가장 급함)~6(거의 곧음), H 헤어핀, S 스퀘어(직각) */
  grade: PaceGrade;
  mod: PaceMod;
  /** 총 회전 (°) */
  angleDeg: number;
  /** 가장 급한 곳의 반지름 (m) */
  radiusM: number;
}

export const PACE = {
  /** 방향을 구할 때 앞뒤로 보는 거리 (m): 꺾은선 꼭짓점의 날카로움을 편다 */
  chordM: 5,
  /** 곡률 창 (m) */
  windowM: 20,
  /** 이보다 곡률이 크면 커브 구간 (1/m) */
  kMin: 1 / 300,
  /** 같은 방향 커브가 이만큼 안에 이어지면 하나로 (m) */
  mergeM: 15,
  /** 총 회전이 이보다 작으면 버린다 (°) */
  minAngleDeg: 20,
  /** 등급 경계 반지름 (m): 1 < 20 ≤ 2 < 30 ≤ 3 < 45 ≤ 4 < 65 ≤ 5 < 100 ≤ 6 */
  gradeR: [20, 30, 45, 65, 100] as const,
  hairpin: { minAngleDeg: 135, maxR: 30 },
  square: { minAngleDeg: 70, maxAngleDeg: 110, maxR: 15 },
  /** 앞·뒤 1/3 반지름 비가 이보다 작으면 조여짐·풀림 */
  tightenRatio: 0.65,
  /** 이보다 긴 커브(등급 3 이상)는 길게 (m) */
  longM: 100,
  /** 다음 커브가 이 안에 시작하면 "이어서" (m) */
  thenM: 30,
  /** 이 안에 있는 커브만 보인다 (m) */
  showM: 250,
} as const;

/** 코스 선 → 커브 목록 (s0 순서) */
export function paceNotes(cl: Polyline): PaceNote[] {
  const L = cl.length;
  const h = PACE.windowM / 2;
  if (!(L > PACE.windowM)) return [];
  // 1 m마다 진행 방향 (앞뒤 5 m 현의 방향, 펼친 값)
  const n = Math.floor(L) + 1;
  const psi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = polylinePoint(cl, Math.max(0, i - PACE.chordM));
    const b = polylinePoint(cl, Math.min(L, i + PACE.chordM));
    let v = Math.atan2(b.y - a.y, b.x - a.x);
    if (i > 0) v += Math.round((psi[i - 1]! - v) / (2 * Math.PI)) * 2 * Math.PI;
    psi[i] = v;
  }
  // 곡률: 앞뒤 10 m 방향 차이 ÷ 거리 (왼쪽 회전이 +)
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, Math.round(i - h));
    const b = Math.min(n - 1, Math.round(i + h));
    k[i] = b > a ? (psi[b]! - psi[a]!) / (b - a) : 0;
  }
  // 같은 부호로 문턱을 넘는 구간
  const runs: Array<{ b: number; e: number; sign: number }> = [];
  for (let i = 0; i < n; ) {
    if (Math.abs(k[i]!) < PACE.kMin) {
      i++;
      continue;
    }
    const sign = Math.sign(k[i]!);
    let e = i;
    while (e + 1 < n && Math.sign(k[e + 1]!) === sign && Math.abs(k[e + 1]!) >= PACE.kMin) e++;
    const last = runs[runs.length - 1];
    if (last && last.sign === sign && i - last.e < PACE.mergeM) last.e = e;
    else runs.push({ b: i, e, sign });
    i = e + 1;
  }
  const maxK = (b: number, e: number) => {
    let m = 0;
    for (let i = Math.max(0, b); i <= Math.min(n - 1, e); i++) m = Math.max(m, Math.abs(k[i]!));
    return m;
  };
  const notes: PaceNote[] = [];
  for (const r of runs) {
    const angleDeg = (Math.abs(psi[r.e]! - psi[r.b]!) * 180) / Math.PI;
    if (angleDeg < PACE.minAngleDeg) continue;
    const radiusM = 1 / maxK(r.b, r.e);
    let grade: PaceGrade;
    if (angleDeg >= PACE.hairpin.minAngleDeg && radiusM < PACE.hairpin.maxR) grade = 'H';
    else if (angleDeg >= PACE.square.minAngleDeg && angleDeg <= PACE.square.maxAngleDeg && radiusM < PACE.square.maxR) grade = 'S';
    else {
      const i = PACE.gradeR.findIndex((lim) => radiusM < lim);
      grade = (i < 0 ? 6 : i + 1) as PaceGrade;
    }
    const len = r.e - r.b;
    const third = Math.max(1, Math.round(len / 3));
    const rFirst = 1 / maxK(r.b, r.b + third);
    const rLast = 1 / maxK(r.e - third, r.e);
    let mod: PaceMod = null;
    if (rLast < rFirst * PACE.tightenRatio) mod = '조여짐';
    else if (rFirst < rLast * PACE.tightenRatio) mod = '풀림';
    else if (len >= PACE.longM && typeof grade === 'number' && grade >= 3) mod = '길게';
    notes.push({ s0: r.b, s1: r.e, dir: r.sign > 0 ? 'left' : 'right', grade, mod, angleDeg, radiusM });
  }
  return notes;
}

export interface UpcomingNote {
  note: PaceNote;
  /** 남은 거리 (10 m 단위, 최소 10) */
  distM: number;
  /** 이 커브 끝에서 30 m 안에 시작하는 다음 커브 */
  then: PaceNote | null;
}

/** 지금 코스 위치 s에서 앞에 시작하는 첫 커브 (보이는 거리 안이면) */
export function upcomingNote(notes: readonly PaceNote[], s: number, opts: { lengthM: number; loop: boolean; maxDistM?: number }): UpcomingNote | null {
  if (notes.length === 0) return null;
  const maxDist = opts.maxDistM ?? PACE.showM;
  let i = notes.findIndex((n) => n.s0 > s);
  let dist: number;
  if (i >= 0) dist = notes[i]!.s0 - s;
  else if (opts.loop) {
    i = 0;
    dist = notes[0]!.s0 + opts.lengthM - s;
  } else return null;
  if (dist > maxDist) return null;
  const note = notes[i]!;
  const nextIdx = i + 1 < notes.length ? i + 1 : opts.loop ? 0 : -1;
  const next = nextIdx >= 0 && nextIdx !== i ? notes[nextIdx]! : null;
  const gap = next ? (next.s0 >= note.s1 ? next.s0 - note.s1 : next.s0 + opts.lengthM - note.s1) : Infinity;
  return { note, distM: Math.max(10, Math.round(dist / 10) * 10), then: next && gap <= PACE.thenM ? next : null };
}
