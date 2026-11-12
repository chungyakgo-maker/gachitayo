// 가상 친구 따라가기 (재생 모드, 사용자 요청 "내가 직접 시뮬 돌려보기"): 오벌 서킷에서 앞 친구 '지훈'이 달리고 나는 뒤따른다.
// 간격(친구가 나보다 몇 초 앞인지): 2.7초(멂) → 2.0초(유지) → 1.4초(가까움) → 66초부터 친구 위치 끊김.
// 실제 폰처럼 친구 위치는 1초마다 GPS 잡음 3 m와 GPS 속도를 담아 오고, 0.8초 늦게 도착한다. 내 GPS도 0.5초 늦다.
import { fromLocal } from '../engine/geo';
import type { GpsSample, RawMotionSample } from '../types/samples';
import { mulberry32 } from './random';
import { simulateDrive, truthAt } from './drive';
import { defaultSensorOpts, synthesizeSensors } from './sensors';
import { stadiumTrack } from './track';

export interface FriendScenario {
  gps: GpsSample[];
  motion: RawMotionSample[];
  /** 친구 위치 (t: GPS 기준 epoch ms) */
  friend: Array<{ t: number; lat: number; lon: number; speed: number; heading: null; hAcc: number }>;
  /** 친구 위치가 늦게 도착하는 시간 ms */
  lagMs: number;
  /** 세션 시계 0이 GPS 기준 epoch로 몇 ms인지 */
  startEpochMs: number;
  targetS: number;
}

export const FRIEND_SCENARIO_TARGET_S = 2;
export const FRIEND_SCENARIO_LOST_AT_S = 66;

/** 친구가 나보다 몇 초 앞인지 (벽시계 T초, 친구 기준) */
export const scenarioGapAt = (T: number) => (T < 24 ? 2.7 : T < 32 ? 2.7 - ((T - 24) / 8) * 0.7 : T < 42 ? 2.0 : T < 50 ? 2.0 - ((T - 42) / 8) * 0.6 : 1.4);

export function friendScenario(seed = 5): FriendScenario {
  const truth = simulateDrive(stadiumTrack(), { laps: 3, startStopS: 4, endStopS: 3, vMax: 32, aLatMax: 7, aAccel: 3, aBrake: 6 });
  const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed, gpsLatencyMs: 500 });
  const rnd = mulberry32(seed + 1000);
  const noise = () => (rnd() - 0.5) * 6;
  const friend: FriendScenario['friend'] = [];
  for (let T = 0; T < FRIEND_SCENARIO_LOST_AT_S; T += 1) {
    const p = truthAt(truth, T + scenarioGapAt(T));
    const ll = fromLocal(s.origin, p.x + noise(), p.y + noise());
    // 친구 속도 = 경로 속도 × (1 + 간격 변화율): 간격이 줄면 친구가 상대적으로 느리다
    const dg = scenarioGapAt(T + 0.5) - scenarioGapAt(T - 0.5);
    friend.push({ t: s.startedAtEpochMs + T * 1000, lat: ll.lat, lon: ll.lon, speed: Math.max(0, p.v * (1 + dg) + (rnd() - 0.5) * 0.3), heading: null, hAcc: 5 });
  }
  return { gps: s.gps, motion: s.motion, friend, lagMs: 800, startEpochMs: s.startedAtEpochMs, targetS: FRIEND_SCENARIO_TARGET_S };
}
