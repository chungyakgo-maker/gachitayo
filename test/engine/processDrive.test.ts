import { describe, expect, it } from 'vitest';
import {
  defaultSensorOpts,
  segmentTrack,
  simulateDrive,
  stadiumTrack,
  synthesizeSensors,
  upDownUp,
  windingWithHairpins,
  type DriveOpts,
  type SensorOpts,
} from '../generators';
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

function session(opts: DriveOpts, seed: number, sensor: Partial<SensorOpts> = {}, track = oval) {
  const truth = simulateDrive(track, opts);
  const s = synthesizeSensors(truth, { ...defaultSensorOpts, ...sensor, seed });
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
    for (const col of [p.lat, p.lon, p.speed, p.heading, p.ax, p.ay, p.s, p.lapNo, p.alt, p.utc!, p.hAcc!]) expect(col.length).toBe(p.n);
    expect(Math.abs(p.lat[0]! - ORIGIN.lat)).toBeLessThan(0.01);
    expect(Math.max(...p.lapNo)).toBe(first.laps.length);
  });

  it('처리된 궤적에 GPS 기준 UTC 시각과 수평 정확도 열이 있다 (사양서 6.7, 13.1 확장 지점)', () => {
    const lat = 180;
    const s = session(base, 82, { gpsLatencyMs: lat });
    const r = processDrive({ gps: s.gps, motion: s.motion, events: startEvent, course: null, startedAtEpochMs: s.startedAtEpochMs });
    const p = r.processed;
    const utc = p.utc!;
    const hAcc = p.hAcc!;
    expect(utc.length).toBe(p.n);
    expect(hAcc.length).toBe(p.n);
    // 융합 시각은 수신 시각 기준이라, 그 위치에 실제로 있던 절대 시각은 GPS 지연만큼 앞이다
    for (let k = 0; k < p.n; k += 37) expect(Math.abs(utc[k]! - (s.startedAtEpochMs + p.t[k]! - lat))).toBeLessThanOrEqual(40);
    for (let k = 1; k < p.n; k++) expect(utc[k]!).toBeGreaterThan(utc[k - 1]!);
    const accs = s.gps.map((g) => g.hAcc);
    for (const a of hAcc) {
      expect(a).toBeGreaterThanOrEqual(Math.min(...accs) - 0.05);
      expect(a).toBeLessThanOrEqual(Math.max(...accs) + 0.05);
    }
  });

  it('GPS 시각이 이상하면(기기 시계 오류) 세션 시작 시각 기준으로 UTC를 정한다', () => {
    const s = session(base, 83);
    const broken = s.gps.map((g) => ({ ...g, tFix: 1000 + g.tRecv }));
    const r = processDrive({ gps: broken, motion: s.motion, events: startEvent, course: null, startedAtEpochMs: s.startedAtEpochMs });
    expect(r.processed.utc![0]).toBe(s.startedAtEpochMs + r.processed.t[0]!);
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

describe('M4 검토 수정', () => {
  it('모션이 1초 끊겨도, 늦게 시작해도 처리된 궤적의 G값은 대부분 남는다', () => {
    for (const gaps of [[[60, 61]], [[0, 1.5]]] as Array<Array<[number, number]>>) {
      const s = session(base, 84, { motionGaps: gaps });
      const r = processDrive({ gps: s.gps, motion: s.motion, events: startEvent, course: null });
      const p = r.processed;
      const ok = p.ax.filter((v, i) => v !== null && p.ay[i] !== null).length;
      expect(ok / p.n).toBeGreaterThan(0.9);
    }
  });

  it('지도 등록 코스: 첫 랩에 앱 중단이 있으면 중단 없는 다음 랩으로 중심선을 만든다', () => {
    const course = { ...courseFromTrack(oval, { gateAtS: 100 }), centerline: null, lengthM: null, sectorBoundsM: null, source: 'map' as const };
    // 한 바퀴 약 45초: 첫 랩(출발선 통과 약 13초 뒤) 안에서 10초 중단
    const gap: [number, number] = [25, 35];
    const s = session({ ...base, laps: 4 }, 85, { dropouts: [gap], motionGaps: [gap] });
    const events: SessionEvent[] = [
      { t: 0, type: 'start' },
      { t: gap[0] * 1000, type: 'pause' },
      { t: gap[1] * 1000, type: 'resume' },
    ];
    const r = processDrive({ gps: s.gps, motion: s.motion, events, course });
    expect(Math.abs(r.course!.lengthM! - oval.length) / oval.length).toBeLessThan(0.02);
    expect(r.laps[0]!.invalidReason).toBe('interrupted');
    expect(r.laps.slice(1).every((l) => l.valid)).toBe(true);
  });

  it('첫 주행으로 자동 생성한 편도 코스: 다른 날 같은 길을 달리면 매번 랩이 잡힌다', () => {
    const w = windingWithHairpins();
    const p2p: DriveOpts = { ...base, laps: 1, vMax: 30, aLatMax: 6 };
    const first = session(p2p, 21, {}, w);
    const made = processDrive({ gps: first.gps, motion: first.motion, events: startEvent, course: null });
    expect(made.course!.kind).toBe('point_to_point');
    expect(made.laps).toHaveLength(1);
    for (const seed of [21, 22, 23]) {
      const s = session(p2p, seed + 100, {}, w);
      const r = processDrive({ gps: s.gps, motion: s.motion, events: startEvent, course: made.course });
      expect(r.laps, `seed ${seed}`).toHaveLength(1);
      expect(r.laps[0]!.valid).toBe(true);
    }
  });

  it('첫 주행에 편도를 두 번(올라감→U턴→내려옴→U턴→올라감): 편도 코스 하나, 랩 2개. 내려오는 길의 코스 거리는 없음', () => {
    const w = windingWithHairpins();
    const opts: DriveOpts = { ...base, laps: 1, vMax: 30, aLatMax: 6 };
    const s = session(opts, 31, {}, upDownUp(w));
    const r = processDrive({ gps: s.gps, motion: s.motion, events: startEvent, course: null });
    expect(r.course!.kind).toBe('point_to_point');
    expect(r.laps).toHaveLength(2);
    expect(r.laps.map((l) => l.lapNo)).toEqual([1, 2]);
    expect(r.laps.every((l) => l.valid)).toBe(true);
    // 첫 랩이 끝난 뒤 내려오는 동안(랩 밖)은 코스 거리를 모른다
    const between = r.processed.t
      .map((t, i) => ({ t, s: r.processed.s[i] }))
      .filter((p) => p.t > r.laps[0]!.endT + 5000 && p.t < r.laps[1]!.startT - 5000);
    expect(between.length).toBeGreaterThan(50);
    expect(between.every((p) => p.s === null)).toBe(true);
  });

  it('사용자가 종료 화면에서 편도를 고르면 편도로 다시 만든다', () => {
    const s = session(base, 86);
    const r = processDrive({ gps: s.gps, motion: s.motion, events: startEvent, course: null, newCourse: { id: 'n', name: 'n', kind: 'point_to_point' } });
    expect(r.course!.kind).toBe('point_to_point');
  });
});

describe('주행 중 엔진: 편도 랩 번호', () => {
  it('완주 → 출발했다 되돌아감 → 완주: 랩 번호는 완주한 순서대로 1, 2 (주행 후 처리와 같다)', () => {
    const line = segmentTrack([{ straight: 400 }]);
    const geom = buildGeometry(courseFromTrack(line, { startInsetM: 20, finishInsetM: 20 }));
    const live = new LiveEngine(geom, null);
    let t = 0;
    const done: number[] = [];
    const go = (x0: number, x1: number, v = 20) => {
      const step = (Math.sign(x1 - x0) * v) / 10;
      for (let x = x0; Math.sign(x1 - x0) * (x1 - x) > 0; x += step) {
        t += 100;
        const st = live.push({ t, x, y: 0, v, sigmaPos: 2, ax: null, ay: null, gpsOk: true, gCalibrated: false });
        if (st.lastLap && !done.includes(st.lastLap.lapNo) && st.lastLap.t > t - 200) done.push(st.lastLap.lapNo);
      }
    };
    const wait = (s: number) => {
      for (let i = 0; i < s * 10; i++) {
        t += 100;
        live.push({ t, x: 0, y: 0, v: 0, sigmaPos: 2, ax: null, ay: null, gpsOk: true, gCalibrated: false });
      }
    };
    go(0, 400);
    t += 20_000;
    wait(3);
    go(0, 100);
    go(100, 0);
    wait(12);
    go(0, 400);
    expect(done).toEqual([1, 2]);
  });
});

describe('GPS 속도·진행 방향 값이 없는 기기의 주행 후 처리', () => {
  it('모션도 없을 때 첫 주행 코스 길이가 둘레의 3% 안, 랩이 유효', () => {
    const s = session(base, 87, { speedNull: true, headingNull: true });
    const r = processDrive({ gps: s.gps, motion: [], events: startEvent, course: null });
    expect(r.course!.kind).toBe('loop');
    expect(Math.abs(r.course!.lengthM! - oval.length) / oval.length).toBeLessThan(0.03);
    expect(r.laps.filter((l) => l.valid).length).toBeGreaterThanOrEqual(1);
  });
});
