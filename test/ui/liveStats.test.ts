import { describe, expect, it } from 'vitest';
import { LiveStatsTracker } from '../../src/ui/recording/liveStats';
import type { GpsSample, RawMotionSample } from '../../src/types/samples';

const gps = (tRecv: number, over: Partial<GpsSample> = {}): GpsSample => ({
  tRecv,
  tFix: 0,
  lat: 37,
  lon: 127,
  alt: null,
  altAcc: null,
  hAcc: 5,
  speed: null,
  heading: null,
  ...over,
});
const motion = (t: number, rx: number | null = 0.1): RawMotionSample => ({
  t,
  gax: 0,
  gay: 0,
  gaz: 9.8,
  rx,
  ry: rx,
  rz: rx,
});

describe('LiveStatsTracker', () => {
  it('처음에는 아무 값도 없다', () => {
    const s = new LiveStatsTracker().snapshot(0);
    expect(s.gpsCount).toBe(0);
    expect(s.lastHAcc).toBeNull();
    expect(s.secondsSinceGps).toBeNull();
    expect(s.speedAvailable).toBeNull();
    expect(s.motionHz).toBe(0);
    expect(s.rotationAvailable).toBeNull();
  });

  it('GPS 횟수, 마지막 정확도, 마지막 수신 뒤 경과 초', () => {
    const tr = new LiveStatsTracker();
    tr.addGps(gps(1000, { hAcc: 8 }));
    tr.addGps(gps(2000, { hAcc: 6 }));
    tr.addGps(gps(3000, { hAcc: 4.2 }));
    const s = tr.snapshot(3500);
    expect(s.gpsCount).toBe(3);
    expect(s.lastHAcc).toBe(4.2);
    expect(s.secondsSinceGps).toBe(0.5);
  });

  it('속도·방향 값이 한 번이라도 오면 "있음", 한 번도 안 오면 "없음"', () => {
    const none = new LiveStatsTracker();
    none.addGps(gps(0));
    expect(none.snapshot(0).speedAvailable).toBe(false);
    expect(none.snapshot(0).headingAvailable).toBe(false);

    const some = new LiveStatsTracker();
    some.addGps(gps(0, { speed: 12, heading: 90 }));
    some.addGps(gps(1000)); // 정지하면 방향이 null로 올 수 있다
    expect(some.snapshot(1000).speedAvailable).toBe(true);
    expect(some.snapshot(1000).headingAvailable).toBe(true);
    expect(some.snapshot(1000).lastSpeedKmh).toBeNull();
  });

  it('최근 2초 동안 받은 모션 수로 주기(Hz)를 계산한다', () => {
    const tr = new LiveStatsTracker();
    for (let i = 0; i < 300; i++) tr.addMotion(motion((i * 1000) / 60)); // 60 Hz로 5초
    expect(tr.snapshot(5000).motionHz).toBeCloseTo(60, 0);
    expect(tr.snapshot(5000).motionCount).toBe(300);
  });

  it('회전 속도가 null이면 "자이로 없음"', () => {
    const tr = new LiveStatsTracker();
    tr.addMotion(motion(0, null));
    expect(tr.snapshot(0).rotationAvailable).toBe(false);
  });
});
