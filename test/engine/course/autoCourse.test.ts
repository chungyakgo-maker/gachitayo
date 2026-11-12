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
  upDownUp,
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

function detect(
  track: Track,
  opts: Partial<DriveOpts> = {},
  seed = 61,
  detectOpts: Parameters<typeof detectCourse>[2] = {},
  sensor: Partial<typeof defaultSensorOpts> = {},
) {
  const truth = simulateDrive(track, { ...drive, ...opts });
  const s = synthesizeSensors(truth, { ...defaultSensorOpts, ...sensor, seed });
  const r = processSession({ gps: s.gps, motion: s.motion, origin: ORIGIN });
  return detectCourse(r.track, ORIGIN, detectOpts);
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

  it('편도 한 번: 출발선은 처음 3 m/s 넘은 곳에서 20 m 안쪽, 도착선은 마지막 3 m/s 지점에서 20 m 앞 (M4 검토 결정)', () => {
    const w = windingWithHairpins();
    const d = detect(w, { vMax: 30, aLatMax: 6 })!;
    expect(d.kind).toBe('point_to_point');
    const s = gateSegment(d.startGate, ORIGIN);
    const f = gateSegment(d.finishGate, ORIGIN);
    // 정차 위치(0,0)에서 GPS 오차보다 충분히 떨어져 있어야 다음 주행에서 출발 순간이 애매하지 않다
    const sAlong = Math.hypot(s.cx, s.cy);
    expect(sAlong).toBeGreaterThan(14);
    expect(sAlong).toBeLessThan(32);
    const expectFinish = w.pointAt(w.length - 21.5);
    expect(Math.hypot(f.cx - expectFinish.x, f.cy - expectFinish.y)).toBeLessThan(10);
  });

  it('편도를 왕복(제자리 회전): 도착선은 출발점 근처가 아니라 돌아선 지점 앞', () => {
    const w = windingWithHairpins();
    const path = joinTracks(w, reversedTrack(w));
    const d = detect(path, { vMax: 30, aLatMax: 6, stops: [{ s: w.length, durationS: 4 }] })!;
    expect(d.kind).toBe('point_to_point');
    // 생성기는 꼭대기에서 제자리로 방향을 뒤집는다(후진을 섞은 3점 회전과 비슷). 융합 궤적이 그곳을 옆으로 휘어 그려서
    // U턴 길이 상한(30 m) + 안쪽 20 m만큼 앞에 생긴다
    const f = gateSegment(d.finishGate, ORIGIN);
    const turn = w.pointAt(w.length);
    expect(Math.hypot(f.cx - turn.x, f.cy - turn.y)).toBeLessThan(55);
    expect(Math.hypot(f.cx - turn.x, f.cy - turn.y)).toBeGreaterThan(15);
  });

  it('올라감→U턴→내려옴→U턴→또 올라감: 같은 길을 되짚은 경로는 랩 코스가 아니다. 편도, 중심선은 첫 1회 주행 (M4 검토 결정)', () => {
    const w = windingWithHairpins();
    const d = detect(upDownUp(w), { vMax: 30, aLatMax: 6 })!;
    expect(d.kind).toBe('point_to_point');
    // 출발 쪽 약 21.5 m, 도착 쪽(U턴 시작 전) 약 20 m 안쪽 → 약 w.length − 42
    expect(Math.abs(d.centerline.length - (w.length - 42))).toBeLessThan(15);
    const f = gateSegment(d.finishGate, ORIGIN);
    const expectFinish = w.pointAt(w.length - 20);
    expect(Math.hypot(f.cx - expectFinish.x, f.cy - expectFinish.y)).toBeLessThan(12);
    expect(bearingDiff(d.finishGate.bearingDeg, 90 - 60)).toBeLessThan(20);
  });

  it('사용자가 편도를 고르면 편도로 만든다, 랩을 골랐는데 랩이 없으면 null', () => {
    const oval = stadiumTrack();
    const p2p = detect(oval, { laps: 2 }, 61, { kind: 'point_to_point' })!;
    expect(p2p.kind).toBe('point_to_point');
    const w = windingWithHairpins();
    expect(detect(w, { vMax: 30, aLatMax: 6 }, 61, { kind: 'loop' })).toBeNull();
  });

  it('첫 랩에 앱 중단·GPS 끊김이 있으면 그 랩으로 중심선을 만들지 않는다', () => {
    const oval = stadiumTrack();
    const gap: [number, number] = [40, 60];
    const d = detect(oval, { laps: 3 }, 61, { exclude: [[gap[0] * 1000, gap[1] * 1000]] }, { dropouts: [gap], motionGaps: [gap] })!;
    expect(d.kind).toBe('loop');
    expect(Math.abs(d.centerline.length - oval.length) / oval.length).toBeLessThan(0.02);
    expect(d.lapRange[0]).toBeGreaterThan(gap[1] * 1000);
  });
});
