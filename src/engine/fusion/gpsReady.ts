// GPS 준비 판정 (사양서 7.4): hAcc ≤ 10 m fix가 5개 연속이면 "준비 완료".
// 나쁜 값이 오면 다시 센다 (지금 상태를 그대로 보여주기 위해).
import { config } from '../config';

export class GpsReadiness {
  private streak = 0;

  get ready(): boolean {
    return this.streak >= config.gpsReady.consecutive;
  }

  push(s: { hAcc: number }): boolean {
    this.streak = s.hAcc <= config.gpsReady.maxHAccM ? this.streak + 1 : 0;
    return this.ready;
  }
}
