import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, polylineTrack, simulateCourseDrive, simulateDrive, stadiumTrack, synthesizeSensors } from './index';
import { BUILTIN_COURSES, builtinCourse } from '../../src/courses/builtin';
import { BUILTIN_POINTS } from '../../src/courses/builtinData';
import { LivePipeline, type LiveSnapshot } from '../../src/engine/live/livePipeline';
import { processDrive } from '../../src/engine/process/processDrive';
import type { Course } from '../../src/types/course';
import type { GpsSample, RawMotionSample } from '../../src/types/samples';

/** 원본을 시간 순서대로 100 ms마다 흘려 스냅숏의 상태만 모은다 (path는 계속 자라는 배열이라 빼고) */
function run(course: Course, gps: GpsSample[], motion: RawMotionSample[]): Array<NonNullable<LiveSnapshot['state']>> {
  const p = new LivePipeline({ course, ref: null });
  const end = Math.max(gps.at(-1)!.tRecv, motion.at(-1)!.t);
  const out: Array<NonNullable<LiveSnapshot['state']>> = [];
  let i = 0;
  let j = 0;
  for (let t = 0; t <= end; t += 100) {
    while (i < gps.length && gps[i]!.tRecv <= t) p.pushGps(gps[i++]!);
    while (j < motion.length && motion[j]!.t <= t) p.pushMotion(motion[j++]!);
    const s = p.tick(t);
    if (s.state) out.push(s.state);
  }
  return out;
}

describe('모의주행 가상 코스 (사양서 10.2)', () => {
  it('점들로 만든 코스: 원호의 곡률은 1/반지름, 직선은 0, 길이는 점 사이 길이 합', () => {
    const pts: Array<[number, number]> = [];
    for (let s = 0; s < 100; s += 1) pts.push([s, 0]);
    // 반지름 100 m 왼쪽 90° 원호 (중심 (100, 100))
    for (let k = 0; k < 157; k += 1) {
      const a = k / 100;
      pts.push([100 + 100 * Math.sin(a), 100 - 100 * Math.cos(a)]);
    }
    for (let s = 0; s <= 100; s += 1) pts.push([200, 100 + s]);
    const tr = polylineTrack(pts);
    expect(tr.closed).toBe(false);
    expect(Math.abs(tr.length - (100 + 157.08 + 100))).toBeLessThan(1.5);
    const arcMid = tr.pointAt(100 + 78.5).curvature;
    expect(Math.abs(arcMid - 0.01) / 0.01).toBeLessThan(0.1);
    expect(Math.abs(tr.pointAt(40).curvature)).toBeLessThan(0.001);
    expect(Math.abs(tr.pointAt(100 + 157 + 60).curvature)).toBeLessThan(0.001);
  });

  it('편도 기본 코스(하오고개): 출발선부터 도착선까지 한 번 달려 랩 1이 끝나고, 80 km/h를 넘지 않는다', () => {
    const b = BUILTIN_COURSES.find((x) => x.key === 'haogogae')!;
    const course = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: 'hao', gateWidthM: 30 });
    const sim = simulateCourseDrive(course);
    expect(sim.durationMs).toBeGreaterThan(0);
    const states = run(course, sim.gps, sim.motion);
    const laps = new Set(states.map((s) => s.lastLap?.lapNo).filter((n) => n !== undefined));
    expect([...laps]).toEqual([1]);
    expect(Math.max(...states.map((s) => s.speedKmh))).toBeLessThanOrEqual(81);
    const lap = states.find((s) => s.lastLap)!.lastLap!;
    expect(lap.timeMs).toBeGreaterThan((course.lengthM! / (80 / 3.6)) * 1000);
  });

  it('랩 코스: 출발선을 지나 한 바퀴 돌고 다시 지나 랩 1만 끝난다', () => {
    const base = { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };
    const first = synthesizeSensors(simulateDrive(stadiumTrack(), base), { ...defaultSensorOpts, seed: 91 });
    const course = processDrive({ gps: first.gps, motion: first.motion, events: [{ t: 0, type: 'start' }], course: null }).course!;
    expect(course.kind).toBe('loop');
    const sim = simulateCourseDrive(course);
    const states = run(course, sim.gps, sim.motion);
    const laps = new Set(states.map((s) => s.lastLap?.lapNo).filter((n) => n !== undefined));
    expect([...laps]).toEqual([1]);
  });

  it('코스 선이 없으면 알기 쉬운 말로 거절한다', () => {
    const b = BUILTIN_COURSES[0]!;
    const course = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: 'x', gateWidthM: 30 });
    expect(() => simulateCourseDrive({ ...course, centerline: null })).toThrow('코스 선이 없어 모의주행을 할 수 없어요');
  });
});
