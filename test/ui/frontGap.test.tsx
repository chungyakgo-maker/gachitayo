import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFrontGap } from '../../src/ui/screens/DriveScreen';
import { fromLocal } from '../../src/engine/geo';
import type { LiveSnapshot } from '../../src/engine/live/livePipeline';
import type { FollowState } from '../../src/app/liveLink';

const origin = { lat: 37.2, lon: 127.1 };
const START = 1_800_000_000_000;
// 앞 친구: 동쪽으로 20 m/s, 1초마다 위치. 나: 같은 길을 2초 늦게
const leaderAt = (tSec: number) => fromLocal(origin, 20 * tSec, 0);

function snap(tSec: number): LiveSnapshot {
  const x = 20 * (tSec - 2);
  return {
    t: tSec * 1000,
    state: null,
    frame: 'course',
    origin,
    utcOffsetMs: START,
    pos: { x, y: 0, psi: 0 },
    gps: { ready: true, hAcc: 4, ageMs: 100 },
    calibration: { state: 'calibrated', stillProgress: 1, signsConfirmed: true, motionActive: true },
    ghost: null,
    path: [],
    pathFrom: 0,
  };
}
const follow = (upTo: number): FollowState => ({
  friendId: 'u2',
  nickname: '지훈',
  connected: true,
  points: Array.from({ length: Math.floor(upTo) + 1 }, (_, i) => ({ t: START + i * 1000, ...leaderAt(i), speed: 20, heading: 90, hAcc: 4 })),
});

describe('주행 화면의 앞 친구 간격 계산 (받은 위치 → 평면 좌표 → 간격)', () => {
  it('2초 늦게 같은 길을 가면 간격 2.0초, 앞 친구 점은 받은 마지막 위치가 아니라 지금 있을 위치 (사용자 요청: 부드럽게)', () => {
    const realNow = Date.now;
    let t = 10;
    Date.now = () => START + t * 1000;
    try {
      const { result, rerender } = renderHook(({ s, f }) => useFrontGap(s, f, 2), { initialProps: { s: snap(t), f: follow(t) } });
      let last = t;
      for (t = 10.1; t < 20; t += 0.1) {
        rerender({ s: snap(t), f: follow(t) });
        last = t;
      }
      expect(result.current.gap).toMatchObject({ nickname: '지훈', targetS: 2, stale: false });
      expect(result.current.gap!.gapS!).toBeCloseTo(2, 1);
      // 마지막으로 받은 건 19초 위치(380 m)지만, 지금(약 19.9초) 친구는 20 m/s로 더 가 있다
      expect(result.current.front!.x).toBeCloseTo(20 * last, 0);
      // 앞 친구를 고르지 않았으면 없음
      rerender({ s: snap(t), f: { ...follow(t), friendId: null } });
      expect(result.current.gap).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});
