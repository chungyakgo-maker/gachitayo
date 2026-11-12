// 기록 화면에 보여줄 실시간 통계. 센서가 실제로 무엇을 주는지 폰에서 확인하는 용도.
import type { GpsSample, RawMotionSample } from '../../types/samples';

export interface LiveStatsSnapshot {
  gpsCount: number;
  /** 마지막 수평 정확도 m */
  lastHAcc: number | null;
  /** 마지막 GPS 수신 뒤 경과 초 */
  secondsSinceGps: number | null;
  /** 마지막 GPS 속도 km/h (값이 없으면 null) */
  lastSpeedKmh: number | null;
  /** GPS 속도 값이 한 번이라도 왔는지 (GPS가 아직 없으면 null) */
  speedAvailable: boolean | null;
  headingAvailable: boolean | null;
  motionCount: number;
  /** 최근 2초 동안의 모션 이벤트 주기 */
  motionHz: number;
  /** 회전 속도(자이로) 값이 오는지 (모션이 아직 없으면 null) */
  rotationAvailable: boolean | null;
}

const HZ_WINDOW_MS = 2000;

export class LiveStatsTracker {
  private gpsCount = 0;
  private lastGps: GpsSample | null = null;
  private speedSeen = false;
  private headingSeen = false;
  private motionCount = 0;
  private recentMotion: number[] = [];
  private rotationAvailable: boolean | null = null;

  addGps(s: GpsSample): void {
    this.gpsCount += 1;
    this.lastGps = s;
    if (s.speed !== null) this.speedSeen = true;
    if (s.heading !== null) this.headingSeen = true;
  }

  addMotion(s: RawMotionSample): void {
    this.motionCount += 1;
    this.recentMotion.push(s.t);
    if (this.recentMotion.length > 1000) this.recentMotion.splice(0, this.recentMotion.length - 1000);
    this.rotationAvailable = s.rx !== null;
  }

  /** now: 세션 시계 ms */
  snapshot(now: number): LiveStatsSnapshot {
    const g = this.lastGps;
    const from = now - HZ_WINDOW_MS;
    const inWindow = this.recentMotion.filter((t) => t > from && t <= now);
    // 창 안의 첫 샘플부터 마지막 샘플까지 간격 수로 계산한다 (조회 시점에 덜 흔들린다)
    const first = inWindow[0];
    const last = inWindow.at(-1);
    const motionHz =
      first !== undefined && last !== undefined && last > first
        ? (inWindow.length - 1) / ((last - first) / 1000)
        : 0;
    return {
      gpsCount: this.gpsCount,
      lastHAcc: g ? g.hAcc : null,
      secondsSinceGps: g ? Math.max(0, now - g.tRecv) / 1000 : null,
      lastSpeedKmh: g && g.speed !== null ? g.speed * 3.6 : null,
      speedAvailable: g ? this.speedSeen : null,
      headingAvailable: g ? this.headingSeen : null,
      motionCount: this.motionCount,
      motionHz,
      rotationAvailable: this.rotationAvailable,
    };
  }
}
