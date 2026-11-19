// 모두의 코스 선 (설계 2부, 시안 ⑥): 공개할 때 1 m 간격 선을 2 m 오차 안으로 줄여 보내고, 받을 때 1 m 로 다시 편다.
// 출발선·도착선은 줄이지 않는다 (같은 코스로 달리려면 게이트가 그대로여야)
import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors } from '../generators';
import { processDrive } from '../../src/engine/process/processDrive';
import { toLocal } from '../../src/engine/geo';
import { courseFromShared, expandLine, sharedBody, simplifyLine } from '../../src/engine/course/share';
import type { Course } from '../../src/types/course';

const truth = simulateDrive(stadiumTrack(), { laps: 2, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });
const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 31 });
const r = processDrive({ gps: s.gps, motion: s.motion, events: [{ t: 0, type: 'start' }], course: null, newCourse: { id: 'c-orig', name: '오벌' } });
const course = r.course!;

/** 점에서 꺾은선까지 거리 m */
function distToLine(p: [number, number], line: Array<[number, number]>): number {
  const o = { lat: p[0], lon: p[1] };
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = toLocal(o, line[i]![0], line[i]![1]);
    const b = toLocal(o, line[i + 1]![0], line[i + 1]![1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t, a.y + dy * t));
  }
  return best;
}

describe('선 줄이기·펴기', () => {
  it('게이트는 그대로, 펴진 선은 원래 선에서 2 m 안, 길이 차 1% 안, 점은 1/5 이하로', () => {
    const body = sharedBody(course, '강원');
    expect(body.startGate).toEqual(course.startGate);
    expect(body.finishGate).toEqual(course.finishGate);
    expect(body.line.length).toBeLessThanOrEqual(course.centerline!.length / 5);
    const back = courseFromShared({ ...body, id: 'pub-1', by: '바람' }, 'local-1');
    expect(back).toMatchObject({ id: 'local-1', name: course.name, kind: course.kind, source: 'shared', shared: { id: 'pub-1', by: '바람' }, version: 1, startGate: course.startGate, finishGate: course.finishGate });
    for (let i = 0; i < back.centerline!.length; i += 7) expect(distToLine(back.centerline![i]!, course.centerline!)).toBeLessThan(2.05);
    expect(Math.abs(back.lengthM! - course.lengthM!) / course.lengthM!).toBeLessThan(0.01);
  });

  it('thumb 는 40점 이하, 좌표는 소수 6자리', () => {
    const body = sharedBody(course, '');
    expect(body.thumb.length).toBeLessThanOrEqual(40);
    expect(body.thumb.length).toBeGreaterThanOrEqual(2);
    for (const [lat, lon] of body.line) {
      expect(Math.round(lat * 1e6) / 1e6).toBe(lat);
      expect(Math.round(lon * 1e6) / 1e6).toBe(lon);
    }
  });

  it('선 없는 코스는 오류 문구', () => {
    expect(() => sharedBody({ ...course, centerline: null } as Course, '')).toThrow('한 번 달려 코스 선이 생긴 뒤에 공개할 수 있어요');
  });

  it('simplifyLine 은 끝점 둘을 남기고, 곧은 선은 두 점이 된다. expandLine 은 간격대로', () => {
    const straight: Array<[number, number]> = Array.from({ length: 101 }, (_, i) => [37 + i * 0.00001, 127]);
    expect(simplifyLine(straight, 2)).toEqual([straight[0], straight[100]]);
    const ex = expandLine([straight[0]!, straight[100]!], 1);
    expect(ex.length).toBeGreaterThan(100);
    expect(ex[0]![0]).toBeCloseTo(37, 6);
  });
});
