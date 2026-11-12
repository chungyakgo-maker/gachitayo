// 랩 안에서의 코스 거리. 출발선과 중심선의 시작·끝이 조금 어긋나 있으면 코스 거리가 출발선보다 먼저(또는 늦게) 넘어간다.
// - 랩의 절반을 달리기 전에 둘레 끝 근처로 읽히면(출발선을 막 지남) 0
// - 랩의 절반을 넘게 달린 뒤 0 근처로 읽히면(출발선을 지나기 직전) 둘레 끝
// 그대로 두면 델타가 한 바퀴만큼 튄다. 넘어감으로 보는 범위는 둘레의 1/4과 50 m 중 작은 쪽 (짧은 코스 대응).
export class LapProgress {
  private maxS = 0;

  constructor(private readonly length: number | null) {}

  reset(): void {
    this.maxS = 0;
  }

  /** inLap이 false면(랩 밖) 그대로 돌려준다 */
  map(s: number | null, inLap: boolean): number | null {
    const L = this.length;
    if (s === null || L === null || !inLap) return s;
    const wrap = Math.min(WRAP_M, L / 4);
    let r = s;
    if (this.maxS < L / 2 && s > L - wrap) r = 0;
    else if (this.maxS > L / 2 && s < wrap) r = L;
    this.maxS = Math.max(this.maxS, r);
    return r;
  }
}
const WRAP_M = 50;
