// 바이크 기울기(뱅크각) 추정 (2026-11-18 세영 "기울기 ㄱㄱ", 바이크 모드):
// 바이크는 몸통째 기울어 폰 좌우 가속도가 거의 0이라 G미터로는 코너가 안 보인다.
// 대신 물리식으로 구한다: 코너에서 기울기 θ는 tan θ = (속도 × 도는 빠르기) / 중력 (바퀴 두께·타는 사람 자세는 무시).
// 도는 빠르기는 융합한 진행 방향(ψ)의 1.5초 기울기(최소제곱)로 구한다. 화면 표시용 추정값이라 기록(처리된 궤적)에는 넣지 않는다.
// 1.5초인 까닭(검토 지적): 거치 보정 전(GPS만)에는 진행 방향이 GPS가 올 때(1초에 한 번) 계단처럼 바뀐다. 0.5초 차이로 구하면
// 실제 30°가 6°~43°로 출렁였고, GPS 한 번 넘는 1.5초 기울기는 28.5°~31.5°. 대신 약 0.7초 늦게 따라간다.
// 자이로로 돌 때도 기울어진 폰은 도는 빠르기를 cos θ만큼 덜 재지만, GPS 방향이 1초마다 바로잡아 1.5초 평균은 실제에 가깝다.

export const LEAN = {
  /** 진행 방향 변화를 보는 시간 (GPS 한 번 간격보다 길게: 짧으면 GPS 계단에서 출렁인다) */
  windowMs: 1500,
  /** 이보다 느리면 0 (주차장·유턴에서 진행 방향 잡음이 큰 기울기로 보이지 않게) */
  minSpeedMps: 15 / 3.6,
  /** 이보다 크게는 보이지 않는다 (도로 바이크는 50° 안팎이 한계, 잡음으로 튀는 값을 자른다) */
  maxDeg: 60,
  /** 출력 평활 시간 상수 ms */
  tauMs: 250,
} as const;

const G = 9.80665;
const DEG = 180 / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clampDeg = (d: number) => Math.max(-LEAN.maxDeg, Math.min(LEAN.maxDeg, d));

/** 속도 v(m/s)·왼쪽으로 도는 빠르기 ω(rad/s) → 기울기 도 (+ 오른쪽, − 왼쪽) */
export const leanDegOf = (v: number, yawRateLeft: number): number => clampDeg(-Math.atan((v * yawRateLeft) / G) * DEG);

export class LeanEstimator {
  /** psi는 이어 붙인 값(±π를 넘어가도 끊기지 않게) */
  private buf: Array<{ t: number; v: number; psi: number }> = [];
  private out = 0;
  private lastT: number | null = null;

  /** t: ms, v: m/s, psi: 진행 방향 (x축에서 반시계 rad) → 기울기 도 (+ 오른쪽, − 왼쪽) */
  push(t: number, v: number, psi: number): number {
    const prev = this.buf[this.buf.length - 1];
    this.buf.push({ t, v, psi: prev ? prev.psi + wrap(psi - prev.psi) : psi });
    while (this.buf.length > 1 && this.buf[1]!.t <= t - LEAN.windowMs) this.buf.shift();
    const a = this.buf[0]!;
    const span = t - a.t;
    let raw = 0;
    if (span >= LEAN.windowMs / 2) {
      // 시간에 대한 진행 방향의 최소제곱 기울기 = 왼쪽으로 도는 빠르기 (rad/ms)
      const n = this.buf.length;
      let mt = 0;
      let mp = 0;
      let mv = 0;
      for (const b of this.buf) {
        mt += b.t / n;
        mp += b.psi / n;
        mv += b.v / n;
      }
      let num = 0;
      let den = 0;
      for (const b of this.buf) {
        num += (b.t - mt) * (b.psi - mp);
        den += (b.t - mt) * (b.t - mt);
      }
      if (mv >= LEAN.minSpeedMps && den > 0) raw = leanDegOf(mv, (num / den) * 1000);
    }
    const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    this.out += (raw - this.out) * (1 - Math.exp(-dt / LEAN.tauMs));
    return Math.abs(this.out) < 0.05 ? 0 : this.out;
  }
}

/** 처리된 궤적(10 Hz: 시각 ms·속도 m/s·나침반 방향 도)에서 최대 기울기 (주행 요약). 달린 구간이 없으면 null */
export function maxLeanOf(track: { t: number[]; speed: number[]; heading: number[] }): { leftDeg: number; rightDeg: number } | null {
  const est = new LeanEstimator();
  let left = 0;
  let right = 0;
  let moved = false;
  for (let i = 0; i < track.t.length; i++) {
    const v = track.speed[i]!;
    // 나침반 방향(북쪽에서 시계 방향 도) → ψ(동쪽에서 반시계 rad)
    const d = est.push(track.t[i]!, v, ((90 - track.heading[i]!) * Math.PI) / 180);
    if (v >= LEAN.minSpeedMps) moved = true;
    if (d > right) right = d;
    if (-d > left) left = -d;
  }
  return moved ? { leftDeg: Math.round(left), rightDeg: Math.round(right) } : null;
}
