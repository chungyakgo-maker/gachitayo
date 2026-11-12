// 보정 전 임시 G (사용자 요청 "G가 처음부터 움직이게"): 거치 보정(7.2)이 끝나기 전에는
// 융합한 속도·진행 방향의 변화로 앞뒤·좌우 가속도를 추정한다. GPS 기반이라 0.5~1초 늦고 덜 정확하다.
// 화면에는 "추정"으로 표시하고, 기록(처리된 궤적)에는 넣지 않는다.
// 모의 주행(1 Hz GPS)에서 정답 대비 RMS 앞뒤 0.21 g·좌우 0.24 g, 대부분 0.5~1초 늦음 탓 (늦음을 빼면 0.08·0.14 g).
// 창을 늘리거나 출력을 더 평활해도 나아지지 않았다.

/** 이 시간 동안의 변화로 기울기를 구한다 (GPS 1 Hz 계단을 고르게) */
const WINDOW_MS = 1000;
/** 이보다 짧으면 0 (출발 직후) */
const MIN_SPAN_MS = 200;
/** 이보다 느리면 진행 방향이 흔들려서 좌우는 0 */
const MIN_TURN_SPEED_MPS = 2;
/** 튀는 값을 자른다 m/s² (약 1.2 g). GPS 진행 방향 잡음으로 코너 진입에서 실제보다 크게 튈 수 있다 */
const CLAMP_MPS2 = 12;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number) => Math.max(-CLAMP_MPS2, Math.min(CLAMP_MPS2, v));

export class GpsAccelEstimator {
  private buf: Array<{ t: number; v: number; psi: number }> = [];

  constructor(private readonly windowMs = WINDOW_MS) {}

  /** t: ms, v: m/s, psi: 진행 방향 (x축에서 반시계 rad) → 앞(+)·왼쪽(+) 가속도 m/s² */
  push(t: number, v: number, psi: number): { ax: number; ay: number } {
    this.buf.push({ t, v, psi });
    while (this.buf.length > 1 && this.buf[1]!.t <= t - this.windowMs) this.buf.shift();
    const a = this.buf[0]!;
    const span = t - a.t;
    if (span < MIN_SPAN_MS) return { ax: 0, ay: 0 };
    const dt = span / 1000;
    const ax = (v - a.v) / dt;
    const vMean = (v + a.v) / 2;
    // 왼쪽으로 돌면 psi가 늘고, 구심 가속도는 왼쪽(+)
    const ay = vMean < MIN_TURN_SPEED_MPS ? 0 : (vMean * wrap(psi - a.psi)) / dt;
    return { ax: clamp(ax), ay: clamp(ay) };
  }
}
