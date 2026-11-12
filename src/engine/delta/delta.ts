// 델타 (사양서 7.11): delta = 현재 랩 경과 시간 − t_ref(s). +면 느린 것.
// 표시: 10 Hz 갱신, 시간 상수 0.3초 지수 평활, 소수 둘째 자리 (자릿수는 화면에서).
import { config } from '../config';
import { refTimeAt, type LapTrace } from './trace';

/** 평활 전 델타 (초) */
export function rawDelta(lapElapsedMs: number, s: number, ref: LapTrace, refLapMs: number, lengthM?: number): number {
  return lapElapsedMs / 1000 - refTimeAt(ref, s, refLapMs, lengthM);
}

/** 지수 평활. 숨김(null)이 들어오면 초기화해서, 다시 나타날 때 옛 값이 섞이지 않게 한다 */
export class DeltaFilter {
  private value: number | null = null;
  private tPrev = 0;

  push(tMs: number, raw: number | null): number | null {
    if (raw === null) {
      this.value = null;
      return null;
    }
    if (this.value === null) {
      this.value = raw;
    } else {
      const dt = Math.max(0, (tMs - this.tPrev) / 1000);
      this.value += (1 - Math.exp(-dt / config.delta.smoothTauS)) * (raw - this.value);
    }
    this.tPrev = tMs;
    return this.value;
  }
}
