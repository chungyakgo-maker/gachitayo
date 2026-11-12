import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, type DriveOpts } from '../generators';
import { processDrive, type DriveResult } from '../../src/engine/process/processDrive';
import { LiveEngine } from '../../src/engine/live/liveEngine';
import { buildGeometry } from '../../src/engine/course/geometry';
import { processSession } from '../../src/engine/fusion/processSession';
import { refTimeAt } from '../../src/engine/delta/trace';
import { courseFromTrack, ORIGIN } from './course/helpers';
import type { SessionEvent } from '../../src/types/samples';

const oval = stadiumTrack();
const base: DriveOpts = { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };
/** 모든 속도를 k배로 (한계를 k, k²배) → 같은 지점의 시각이 1/k배 */
const scaled = (k: number): DriveOpts => ({ ...base, vMax: 40 * k, aLatMax: 8 * k * k, aAccel: 3 * k * k, aBrake: 6 * k * k });
const startEvent: SessionEvent[] = [{ t: 0, type: 'start' }];

function session(opts: DriveOpts, seed: number) {
  const truth = simulateDrive(oval, opts);
  const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed });
  return { truth, ...s };
}

describe('주행 후 처리 (사양서 5.4)', () => {
  let first: DriveResult;

  it('첫 주행(코스 없음): 랩 코스를 만들어 제안하고, 랩·구간·trace를 계산한다', () => {
    const s = session(base, 81);
    first = processDrive({ gps: s.gps, motion: s.motion, events: startEvent, course: null, newCourse: { id: 'new1', name: '새 코스' } });
    expect(first.courseCreated).toBe(true);
    expect(first.course!.kind).toBe('loop');
    expect(first.course!.version).toBe(1);
    expect(first.laps.length).toBeGreaterThanOrEqual(2);
    for (const l of first.laps) {
      expect(l.valid).toBe(true);
      expect(l.trace.t.length).toBe(Math.floor(first.course!.lengthM! / 5) + 1);
    }
    expect(first.theoreticalBest.totalMs).not.toBeNull();
    expect(first.bestLap).not.toBeNull();
  });

  it('처리된 궤적은 10 Hz, 모든 열의 길이가 같다', () => {
    const p = first.processed;
    expect(p.hz).toBe(10);
    for (let i = 1; i < 20; i++) expect(p.t[i]! - p.t[i - 1]!).toBe(100);
    for (const col of [p.lat, p.lon, p.speed, p.heading, p.ax, p.ay, p.s, p.lapNo, p.alt]) expect(col.length).toBe(p.n);
    expect(Math.abs(p.lat[0]! - ORIGIN.lat)).toBeLessThan(0.01);
    expect(Math.max(...p.lapNo)).toBe(first.laps.length);
  });

  it('두 번째 주행(3% 느림): 같은 코스로 처리하고, 주행 중 델타가 정답과 RMS < 0.15초', () => {
    const k = 0.97;
    const s = session(scaled(k), 82);
    const course = first.course!;
    const second = processDrive({ gps: s.gps, motion: s.motion, events: startEvent, course });
    expect(second.courseCreated).toBe(false);
    expect(second.laps.length).toBeGreaterThanOrEqual(2);
    const ref = first.bestLap!;
    // 주행 중과 같은 방식: 한 방향 필터 결과를 주행 중 엔진에 넣는다
    const fused = processSession({ gps: s.gps, motion: s.motion, origin: course.origin }).filtered;
    const geom = buildGeometry(course);
    const live = new LiveEngine(geom, { trace: ref.trace, lapTimeMs: ref.lapTimeMs });
    // 랩별로 모아 두었다가, 주행 중 엔진이 낸 랩타임이 비교 랩 ÷ k에 가까운(같은 조건) 랩만 본다
    // (정지 출발 랩, 마지막 감속이 들어간 랩은 원래 비교 랩과 다르다)
    const errsByLap = new Map<number, number[]>();
    const lapTimes = new Map<number, number>();
    let lapsSeen = 0;
    for (let i = 0; i < fused.n; i++) {
      const st = live.push({
        t: fused.t0 + i * fused.dt,
        x: fused.x[i]!,
        y: fused.y[i]!,
        v: fused.v[i]!,
        sigmaPos: 2,
        ax: null,
        ay: null,
        gpsOk: true,
        gCalibrated: false,
      });
      if (st.lastLap) {
        lapsSeen = Math.max(lapsSeen, st.lastLap.lapNo);
        lapTimes.set(st.lastLap.lapNo, st.lastLap.timeMs);
      }
      if (st.delta !== null && st.s !== null) {
        const expected = (1 / k - 1) * refTimeAt(ref.trace, st.s, ref.lapTimeMs, course.lengthM!);
        errsByLap.set(st.lapNo, [...(errsByLap.get(st.lapNo) ?? []), st.delta - expected]);
      }
    }
    const errs = [...lapTimes.entries()]
      .filter(([, ms]) => Math.abs(ms - ref.lapTimeMs / k) < 0.02 * ref.lapTimeMs)
      .flatMap(([no]) => errsByLap.get(no) ?? []);
    expect(lapsSeen).toBeGreaterThanOrEqual(2);
    expect(errs.length).toBeGreaterThan(500);
    // 출발선 통과 시각 오차와 위치 오차가 비교 랩·현재 랩 양쪽에 들어가므로 RMS 0.1초 안팎이 잡음 한계다 (초기 목표)
    expect(Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length)).toBeLessThan(0.15);
  });

  it('지도로 등록해 중심선이 없는 코스: 첫 랩으로 중심선을 만들고 version을 올린다', () => {
    const course = { ...courseFromTrack(oval, { gateAtS: 100 }), centerline: null, lengthM: null, sectorBoundsM: null, source: 'map' as const };
    const s = session(base, 83);
    const r = processDrive({ gps: s.gps, motion: s.motion, events: startEvent, course });
    expect(r.courseCreated).toBe(false);
    expect(r.courseUpdated).toBe(true);
    expect(r.course!.version).toBe(course.version + 1);
    expect(Math.abs(r.course!.lengthM! - oval.length) / oval.length).toBeLessThan(0.02);
    expect(r.laps.every((l) => l.sectorTimesMs.every((v) => v !== null))).toBe(true);
  });
});

describe('주행 중 엔진 (사양서 8.4)', () => {
  it('첫 주행(코스 없음): 델타 없이 속도와 출발 뒤 경과 시간만', () => {
    const live = new LiveEngine(null, null);
    let st = live.push({ t: 0, x: 0, y: 0, v: 0, sigmaPos: 2, ax: null, ay: null, gpsOk: true, gCalibrated: false });
    st = live.push({ t: 1000, x: 5, y: 0, v: 10, sigmaPos: 2, ax: null, ay: null, gpsOk: true, gCalibrated: false });
    st = live.push({ t: 3000, x: 25, y: 0, v: 10, sigmaPos: 2, ax: null, ay: null, gpsOk: true, gCalibrated: false });
    expect(st.delta).toBeNull();
    expect(st.speedKmh).toBeCloseTo(36, 6);
    expect(st.lapElapsedMs).toBe(2000);
    expect(st.status.courseRecording).toBe(true);
  });

  it('G 보정 전에는 G값 없음, GPS 약함·코스 이탈 상태를 알려준다', () => {
    const geom = buildGeometry(courseFromTrack(oval, { gateAtS: 100 }));
    const live = new LiveEngine(geom, null);
    const st = live.push({ t: 0, x: 0, y: -60, v: 10, sigmaPos: 12, ax: 1, ay: 0, gpsOk: false, gCalibrated: false });
    expect(st.gx).toBeNull();
    expect(st.status).toMatchObject({ gNotCalibrated: true, gpsWeak: true, offCourse: true });
  });
});
