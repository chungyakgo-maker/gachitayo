// 세션 시계 (사양서 6.1): 모든 샘플 시각을 "세션 시작부터 ms"로 잰다.
//
// 페이지 안에서는 단조 증가 시계(performance.now)를 쓴다. 앱이 중단됐다가 이어서 하면
// 새 페이지의 단조 시계는 0부터 다시 시작하므로, 그때의 오프셋은 벽시계(Date.now)
// 차이로 다시 잡는다. 중단 구간의 경계에는 resume 이벤트가 남는다.

export interface SessionClock {
  /** 세션 시작부터 ms */
  now(): number;
}

export function createSessionClock(
  startedAtEpochMs: number,
  perfNow: () => number,
  epochNow: () => number,
): SessionClock {
  const perf0 = perfNow();
  const offset = epochNow() - startedAtEpochMs;
  return { now: () => offset + (perfNow() - perf0) };
}
