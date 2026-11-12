import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, windingWithHairpins } from '../../generators';
import { buildGeometry } from '../../../src/engine/course/geometry';
import { moveGate, refineCourse } from '../../../src/engine/course/edit';
import { closestOnSegment, polylinePoint } from '../../../src/engine/course/polyline';
import { splitLaps } from '../../../src/engine/course/laps';
import { processSession } from '../../../src/engine/fusion/processSession';
import { courseFromTrack, ORIGIN } from './helpers';

const oval = stadiumTrack();

/** 중심선이 정답 코스 모양에서 벗어난 RMS (m) */
function rmsToTruth(cl: { x: Float64Array; y: Float64Array }): number {
  let se = 0;
  for (let i = 0; i < cl.x.length; i += 5) {
    let best = Infinity;
    let prev = oval.pointAt(0);
    for (let s = 1; s <= oval.length; s += 1) {
      const p = oval.pointAt(s);
      best = Math.min(best, closestOnSegment(cl.x[i]!, cl.y[i]!, prev.x, prev.y, p.x, p.y).d);
      prev = p;
    }
    se += best * best;
  }
  return Math.sqrt(se / Math.ceil(cl.x.length / 5));
}

describe('코스 다듬기 (사양서 7.5)', () => {
  it('유효 랩 3개를 평균한 중심선이 한 랩 중심선보다 정답에 가깝고, version이 1 오른다', () => {
    const course = courseFromTrack(oval, { gateAtS: 100 });
    const geom = buildGeometry(course);
    const truth = simulateDrive(oval, { laps: 4, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });
    const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 71 });
    const r = processSession({ gps: s.gps, motion: s.motion, origin: ORIGIN });
    const frames = { n: r.track.n, t: Float64Array.from({ length: r.track.n }, (_, k) => r.track.t0 + k * r.track.dt), x: r.track.x, y: r.track.y, v: r.track.v };
    const laps = splitLaps({ geom, track: frames, gpsTimes: s.gps.map((g) => g.tRecv), pauses: [] }).laps;
    expect(laps.length).toBeGreaterThanOrEqual(3);
    const paths = laps.map((l) => {
      const ks = [...frames.t.keys()].filter((k) => frames.t[k]! >= l.startT && frames.t[k]! <= l.endT);
      return { x: Float64Array.from(ks, (k) => frames.x[k]!), y: Float64Array.from(ks, (k) => frames.y[k]!) };
    });
    const one = refineCourse({ ...course, centerline: null }, paths.slice(0, 1), { minLaps: 1 });
    const three = refineCourse(course, paths.slice(0, 3));
    expect(three.version).toBe(course.version + 1);
    expect(rmsToTruth(buildGeometry(three).centerline!)).toBeLessThan(rmsToTruth(buildGeometry(one).centerline!));
    expect(() => refineCourse(course, paths.slice(0, 2))).toThrow();
  });
});

describe('출발선·도착선 옮기기 (질문 5 결정)', () => {
  it('랩 코스: 게이트를 중심선 위로 붙이고, 중심선 시작을 새 출발선으로 돌린다', () => {
    const course = courseFromTrack(oval);
    const moved = moveGate(course, 'start', 300, 3);
    const g = buildGeometry(moved);
    expect(moved.version).toBe(course.version + 1);
    expect(Math.hypot(g.start.cx - 300, g.start.cy)).toBeLessThan(0.5);
    const first = polylinePoint(g.centerline!, 0);
    expect(Math.hypot(first.x - g.start.cx, first.y - g.start.cy)).toBeLessThan(1);
    expect(moved.finishGate).toEqual(moved.startGate);
    expect(Math.abs(g.centerline!.length - buildGeometry(course).centerline!.length)).toBeLessThan(1);
  });

  it('편도: 도착선을 앞으로 옮기면 중심선 뒤쪽이 잘린다', () => {
    const w = windingWithHairpins();
    const course = courseFromTrack(w);
    const before = buildGeometry(course).centerline!;
    const p = polylinePoint(before, before.length - 100);
    const moved = moveGate(course, 'finish', p.x, p.y);
    const g = buildGeometry(moved);
    expect(g.centerline!.length).toBeCloseTo(before.length - 100, -1);
    expect(moved.lengthM).toBeCloseTo(g.centerline!.length, 6);
    expect(moved.sectorBoundsM![0]).toBeCloseTo(g.centerline!.length / 3, 6);
  });
});
