// 1초에 10번 오는 위치를 화면 주사율(최대 60번)로 이어 그리기 (사용자 요청 "지도가 뚝뚝 끊긴다").
// 받은 두 위치 사이를 시간에 비례해 잇는다. 그러려면 한 칸(약 0.1초) 늦게 그린다. 다음 위치가 늦으면 잠깐(0.5칸) 이어서 늘리고 멈춘다.

export interface Pose {
  x: number;
  y: number;
  psi?: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class PoseLerp {
  private prev: (Pose & { t: number }) | null = null;
  private cur: (Pose & { t: number }) | null = null;

  /** 새 위치 (wallMs: performance.now 기준). 같은 위치가 다시 오면(다시 그리기) 무시한다 */
  push(wallMs: number, p: Pose | null | undefined): void {
    if (!p) {
      this.prev = null;
      this.cur = null;
      return;
    }
    const c = this.cur;
    if (c && c.x === p.x && c.y === p.y && c.psi === p.psi) return;
    // 크게 튀면(좌표계가 바뀜 등) 잇지 않는다
    this.prev = c && Math.hypot(p.x - c.x, p.y - c.y) < 200 ? c : null;
    this.cur = { ...p, t: wallMs };
  }

  /** 화면 시각 wallMs에 그릴 위치 */
  sample(wallMs: number, delayMs = 100): Pose | null {
    const c = this.cur;
    if (!c) return null;
    const a = this.prev;
    if (!a || c.t <= a.t) return { x: c.x, y: c.y, psi: c.psi };
    const u = Math.max(0, Math.min(1.5, (wallMs - delayMs - a.t) / (c.t - a.t)));
    const psi = a.psi === undefined || c.psi === undefined ? c.psi : a.psi + wrap(c.psi - a.psi) * u;
    return { x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u, psi };
  }
}

/** 각도 지수 평활 (시간 상수 tauMs, 한 바퀴 넘어가는 곳도 자연스럽게) */
export function smoothAngleStep(prev: number | null, target: number | null | undefined, dtMs: number, tauMs: number): number | null {
  if (target === null || target === undefined || !Number.isFinite(target)) return prev;
  if (prev === null) return target;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return prev + wrap(target - prev) * k;
}
