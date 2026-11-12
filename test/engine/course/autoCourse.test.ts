import { describe, expect, it } from 'vitest';
import {
  concatTracks,
  defaultSensorOpts,
  joinTracks,
  reversedTrack,
  segmentTrack,
  simulateDrive,
  stadiumTrack,
  synthesizeSensors,
  windingWithHairpins,
  type DriveOpts,
  type Track,
} from '../../generators';
import { detectCourse } from '../../../src/engine/course/autoCourse';
import { processSession } from '../../../src/engine/fusion/processSession';
import { closestOnSegment } from '../../../src/engine/course/polyline';
import { gateSegment } from '../../../src/engine/course/geometry';
import { ORIGIN } from './helpers';

const drive: DriveOpts = { laps: 1, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };

function detect(track: Track, opts: Partial<DriveOpts> = {}, seed = 61) {
  const truth = simulateDrive(track, { ...drive, ...opts });
  const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed });
  const r = processSession({ gps: s.gps, motion: s.motion, origin: ORIGIN });
  return detectCourse(r.track, ORIGIN);
}

/** 점에서 코스 모양까지 거리 */
function distToTrack(track: Track, x: number, y: number, from = 0, to = track.length): number {
  let best = Infinity;
  let prev = track.pointAt(from);
  for (let s = from + 1; s <= to; s += 1) {
    const p = track.pointAt(s);
    best = Math.min(best, closestOnSegment(x, y, prev.x, prev.y, p.x, p.y).d);
    prev = p;
  }
  return best;
}

const bearingDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('첫 주행 자동 코스 생성 (사양서 7.5, 질문 3·4 결정)', () => {
  it('트랙 위에서 출발한 오벌: 랩 코스, 출발선은 출발점 근처, 중심선 길이는 둘레의 2% 안', () => {
    const oval = stadiumTrack();
    const d = detect(oval, { laps: 3 })!;
    expect(d.kind).toBe('loop');
    const g = gateSegment(d.startGate, ORIGIN);
    expect(Math.hypot(g.cx, g.cy)).toBeLessThan(15);
    expect(bearingDiff(d.startGate.bearingDeg, 90)).toBeLessThan(15);
    expect(Math.abs(d.centerline.length - oval.length) / oval.length).toBeLessThan(0.02);
  });

  it('피트(진입로)에서 출발한 서킷: 랩 코스로 인식하고, 출발선은 진입로가 아니라 트랙 위', () => {
    const oval = stadiumTrack();
    const lead = segmentTrack([{ straight: 60 }, { arc: 30, angleDeg: 40 }, { arc: -30, angleDeg: 40 }, { straight: 40 }]);
    const path = concatTracks(lead, oval, 3);
    const d = detect(path)!;
    expect(d.kind).toBe('loop');
    const g = gateSegment(d.startGate, ORIGIN);
    // 트랙(랩 부분)까지 거리 < 5 m
    let best = Infinity;
    let prev = path.loopAt(0);
    for (let s = 1; s <= oval.length; s++) {
      const p = path.loopAt(s);
      best = Math.min(best, closestOnSegment(g.cx, g.cy, prev.x, prev.y, p.x, p.y).d);
      prev = p;
    }
    expect(best).toBeLessThan(5);
    // 진입로 앞부분(합류 40 m 전보다 앞)에 있지 않다
    expect(distToTrack(lead, g.cx, g.cy, 0, lead.length - 40)).toBeGreaterThan(10);
  });

  it('편도 한 번: 출발선은 처음 3 m/s 넘은 곳, 도착선은 끝 근처', () => {
    const w = windingWithHairpins();
    const d = detect(w, { vMax: 30, aLatMax: 6 })!;
    expect(d.kind).toBe('point_to_point');
    const s = gateSegment(d.startGate, ORIGIN);
    const f = gateSegment(d.finishGate, ORIGIN);
    expect(Math.hypot(s.cx, s.cy)).toBeLessThan(15);
    const end = w.pointAt(w.length);
    expect(Math.hypot(f.cx - end.x, f.cy - end.y)).toBeLessThan(20);
  });

  it('편도를 왕복: 도착선은 출발점 근처가 아니라 돌아선 지점 근처', () => {
    const w = windingWithHairpins();
    const path = joinTracks(w, reversedTrack(w));
    const d = detect(path, { vMax: 30, aLatMax: 6, stops: [{ s: w.length, durationS: 4 }] })!;
    expect(d.kind).toBe('point_to_point');
    const f = gateSegment(d.finishGate, ORIGIN);
    const turn = w.pointAt(w.length);
    expect(Math.hypot(f.cx - turn.x, f.cy - turn.y)).toBeLessThan(30);
  });
});
