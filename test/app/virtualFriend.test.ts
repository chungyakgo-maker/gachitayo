import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { FRIEND_SCENARIO_LOST_AT_S, FRIEND_SCENARIO_TARGET_S, friendScenario, scenarioGapAt } from '../../src/sim/friendScenario';
import { getFollowState, pushVirtualPoint, setVirtualFollow, VIRTUAL_FRIEND } from '../../src/app/liveLink';

describe('재생 모드 가상 친구 따라가기 (사용자 요청: 직접 시뮬 돌려보기)', () => {
  it('시나리오: 친구 위치 1초마다(GPS 속도 포함) 66초까지, 0.8초 늦게, 간격 2.7 → 2.0 → 1.4초, 목표 2.0초', () => {
    const sc = friendScenario();
    expect(sc.friend.length).toBe(FRIEND_SCENARIO_LOST_AT_S);
    expect(sc.friend[1]!.t - sc.friend[0]!.t).toBe(1000);
    expect(sc.friend.every((p) => Number.isFinite(p.speed))).toBe(true);
    expect(sc.lagMs).toBe(800);
    expect(sc.gps.length).toBeGreaterThan(100);
    expect([scenarioGapAt(10), scenarioGapAt(36), scenarioGapAt(60)]).toEqual([2.7, 2.0, 1.4]);
    expect(FRIEND_SCENARIO_TARGET_S).toBe(VIRTUAL_FRIEND.targetS);
  });

  it('가상 친구를 켜면 따라가기 상태에 위치가 쌓이고, 끄면 지운다 (실제 친구 연결은 건드리지 않음)', () => {
    setVirtualFollow(true);
    expect(getFollowState()).toMatchObject({ friendId: VIRTUAL_FRIEND.id, nickname: '지훈(가상)', connected: true, points: [] });
    const p = { t: 1_800_000_000_000, lat: 37.2, lon: 127.1, speed: 20, heading: null, hAcc: 5 };
    pushVirtualPoint(p);
    pushVirtualPoint({ ...p, t: p.t + 1000 });
    pushVirtualPoint(p); // 늦게 온 것·같은 것은 무시
    expect(getFollowState().points.map((q) => q.t)).toEqual([p.t, p.t + 1000]);
    setVirtualFollow(false);
    expect(getFollowState().friendId).toBeNull();
  });
});
