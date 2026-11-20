// G미터 최대 G 점 (2026-11-20 세영 "최대게이지만큼 선으로 이어봐 … 밖으로 가면 빨간색으로 진하게, 안쪽이면 파랑색쪽으로 점선으로 찍고 연결",
// 시안 docs/mock/2026-11-20-gpeaks.jpg): 원을 5°씩 72칸으로 나눠 칸마다 이번 주행에서 가장 센 G를 기억한다.
// 화면은 이 점들을 각도 순서대로 직선으로 잇는다 (ui/overlay/gmeter.ts gPeakShape).
// · 요철·과속방지턱처럼 한순간 튀는 값은 0.3초 평균으로 거른다. 값이 끊기면(보정 전 임시 G 등) 평균도 새로 모은다
// · 재생 타임라인은 프레임마다 points()를 그대로 담는다: 바뀌지 않으면 같은 배열을 주고, 바뀌면 새 배열(예전 것은 건드리지 않는다)

export type GPeak = readonly [number, number];

export const G_PEAKS = {
  /** 방향 칸 수 (5°) */
  sectors: 72,
  /** 이만큼(ms) 평균한 G로 잰다 */
  avgMs: 300,
  /** 평균에 이만큼(ms) 넘게 모였을 때만 넣는다 (끊긴 직후의 한두 값으로 재지 않게) */
  minSpanMs: 240,
  /** 이보다 약한 G는 방향이 의미 없어 넣지 않는다 (g) */
  minG: 0.02,
} as const;

const SEC = (Math.PI * 2) / G_PEAKS.sectors;

/** 화면 각도 (G미터와 같은 방향: 화면 x = −좌우, y = 앞뒤 → 오른쪽 0, 아래 90°), 0 ~ 2π */
const angleOf = (gx: number, gy: number) => (Math.atan2(gx, -gy) + Math.PI * 2) % (Math.PI * 2);

export class GPeaks {
  private best: Array<GPeak | null> = new Array(G_PEAKS.sectors).fill(null);
  private win: Array<{ t: number; gx: number; gy: number }> = [];
  private lastT: number | null = null;
  private cache: ReadonlyArray<GPeak> = [];
  private dirty = false;

  /** G 한 칸 (앞뒤 gx: 가속 +, 좌우 gy: 왼쪽 +). 값이 없으면(null) 평균을 끊는다 */
  push(t: number, gx: number | null, gy: number | null): void {
    if (this.lastT !== null && t < this.lastT) this.reset();
    this.lastT = t;
    if (gx === null || gy === null || !Number.isFinite(gx) || !Number.isFinite(gy)) {
      this.win = [];
      return;
    }
    this.win.push({ t, gx, gy });
    while (this.win.length > 0 && this.win[0]!.t < t - G_PEAKS.avgMs) this.win.shift();
    if (t - this.win[0]!.t < G_PEAKS.minSpanMs) return;
    let sx = 0;
    let sy = 0;
    for (const w of this.win) {
      sx += w.gx;
      sy += w.gy;
    }
    const ax = sx / this.win.length;
    const ay = sy / this.win.length;
    const r = Math.hypot(ax, ay);
    if (r < G_PEAKS.minG) return;
    const k = Math.floor(angleOf(ax, ay) / SEC) % G_PEAKS.sectors;
    const b = this.best[k];
    if (b && Math.hypot(b[0], b[1]) >= r) return;
    this.best[k] = [ax, ay];
    this.dirty = true;
  }

  /** 칸마다 가장 센 G [앞뒤, 좌우] — 화면 각도 순서, 빈 칸은 뺀다 */
  points(): ReadonlyArray<GPeak> {
    if (this.dirty) {
      this.cache = this.best.filter((p): p is GPeak => p !== null);
      this.dirty = false;
    }
    return this.cache;
  }

  reset(): void {
    this.best = new Array(G_PEAKS.sectors).fill(null);
    this.win = [];
    this.lastT = null;
    this.cache = [];
    this.dirty = false;
  }
}

const GRAVITY = 9.80665;

/** 저장된 기록(처리된 궤적, 10 Hz · m/s²)의 한 랩에서 방향별 최대 G — 분석 G 다이어그램 (2026-11-20 시안 docs/mock/2026-11-20-gpeaks-analysis.jpg).
 *  주행 화면과 같은 셈(72칸 · 0.3초 평균). G 가 없는 칸(보정 전)은 평균을 끊는다 */
export function lapGPeaks(p: { n: number; t: ReadonlyArray<number>; lapNo: ReadonlyArray<number>; ax: ReadonlyArray<number | null>; ay: ReadonlyArray<number | null> }, lapNo: number): ReadonlyArray<GPeak> {
  const g = new GPeaks();
  for (let k = 0; k < p.n; k++) {
    if (p.lapNo[k] !== lapNo) continue;
    const ax = p.ax[k];
    const ay = p.ay[k];
    g.push(p.t[k]!, ax === null || ax === undefined ? null : ax / GRAVITY, ay === null || ay === undefined ? null : ay / GRAVITY);
  }
  return g.points();
}
