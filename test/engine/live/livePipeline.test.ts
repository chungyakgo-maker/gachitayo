import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, type DriveOpts } from '../../generators';
import { processDrive } from '../../../src/engine/process/processDrive';
import { LivePipeline, type LiveSnapshot } from '../../../src/engine/live/livePipeline';
import { refTimeAt } from '../../../src/engine/delta/trace';
import type { GpsSample, RawMotionSample } from '../../../src/types/samples';

const oval = stadiumTrack();
const base: DriveOpts = { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };
const scaled = (k: number): DriveOpts => ({ ...base, vMax: 40 * k, aLatMax: 8 * k * k, aAccel: 3 * k * k, aBrake: 6 * k * k });

/** 원본 샘플을 시간 순서대로 흘려보내며 100 ms마다 화면 스냅숏을 받는다 (주행 중과 같은 방식) */
function replay(p: LivePipeline, gps: GpsSample[], motion: RawMotionSample[], endMs: number): LiveSnapshot[] {
  const out: LiveSnapshot[] = [];
  let i = 0;
  let j = 0;
  for (let t = 0; t <= endMs; t += 100) {
    while (i < gps.length && gps[i]!.tRecv <= t) p.pushGps(gps[i++]!);
    while (j < motion.length && motion[j]!.t <= t) p.pushMotion(motion[j++]!);
    const s = p.tick(t);
    if (s) out.push(s);
  }
  return out;
}

describe('주행 중 계산 묶음 (사양서 5.3)', () => {
  const first = (() => {
    const truth = simulateDrive(oval, base);
    const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 91 });
    return processDrive({ gps: s.gps, motion: s.motion, events: [{ t: 0, type: 'start' }], course: null });
  })();

  it('첫 주행(코스 없음): GPS 준비, 정차 진행률, 거치 보정, 속도·출발 뒤 경과 시간, 지나온 경로', () => {
    const truth = simulateDrive(oval, base);
    const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 93 });
    const p = new LivePipeline({ course: null, ref: null });
    const snaps = replay(p, s.gps, s.motion, truth.t.at(-1)! * 1000);
    expect(snaps.some((x) => x.gps.ready)).toBe(true);
    expect(snaps.some((x) => x.calibration.stillProgress >= 1)).toBe(true);
    expect(snaps.at(-1)!.calibration.state).toBe('calibrated');
    expect(snaps.some((x) => x.state && !x.state.status.gNotCalibrated && x.state.gx !== null)).toBe(true);
    expect(snaps.at(-1)!.state!.status.courseRecording).toBe(true);
    expect(snaps.at(-1)!.state!.lapElapsedMs).toBeGreaterThan(100_000);
    expect(snaps[0]!.state).toBeNull();
    expect(snaps.at(-1)!.path.length).toBeGreaterThan(500);
    expect(snaps.at(-1)!.frame).toBe('session');
  });

  it('두 번째 주행(3% 느림): 랩을 잡고, 델타가 정답과 RMS < 0.3초, 고스트는 내 앞', () => {
    const k = 0.97;
    const truth = simulateDrive(oval, scaled(k));
    const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 92 });
    const course = first.course!;
    const ref = first.bestLap!;
    const p = new LivePipeline({ course, ref: { trace: ref.trace, lapTimeMs: ref.lapTimeMs, sectorTimesMs: ref.sectorTimesMs } });
    const snaps = replay(p, s.gps, s.motion, truth.t.at(-1)! * 1000);
    const laps = new Map<number, number>();
    for (const x of snaps) if (x.state?.lastLap) laps.set(x.state.lastLap.lapNo, x.state.lastLap.timeMs);
    expect(laps.size).toBeGreaterThanOrEqual(2);
    // 비교 랩 ÷ k에 가까운 랩(같은 조건)만 델타 정답과 비교
    const fair = new Set([...laps].filter(([, ms]) => Math.abs(ms - ref.lapTimeMs / k) < 0.02 * ref.lapTimeMs).map(([no]) => no));
    const errs: number[] = [];
    let ghostAhead = 0;
    let ghostN = 0;
    for (const x of snaps) {
      if (!x.state || x.state.delta === null || x.state.s === null || !fair.has(x.state.lapNo)) continue;
      errs.push(x.state.delta - (1 / k - 1) * refTimeAt(ref.trace, x.state.s, ref.lapTimeMs, course.lengthM!));
      if (x.ghost && x.state.s > 50 && x.state.s < course.lengthM! - 50) {
        ghostN++;
        if (x.ghost.s >= x.state.s - 3) ghostAhead++;
      }
    }
    expect(errs.length).toBeGreaterThan(300);
    expect(Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length)).toBeLessThan(0.3);
    expect(ghostAhead / ghostN).toBeGreaterThan(0.9);
    expect(snaps.at(-1)!.frame).toBe('course');
    expect(snaps.some((x) => x.state?.sectorDeltas[0] != null)).toBe(true);
  });
});

describe('고스트 위치 (사양서 7.11, 10.1)', () => {
  it('고스트는 비교 랩이 같은 랩 경과 시간에 실제로 있던 곳에 있다 (가상 데이터 정답과 비교)', async () => {
    const { truthAt } = await import('../../generators');
    const { fromLocal, toLocal } = await import('../../../src/engine/geo');
    // 비교 랩이 될 첫 주행: 정답(truth1)을 안다. 가상 GPS 지연이 0이라 세션 시계 ms = 정답 시각 × 1000
    const truth1 = simulateDrive(oval, base);
    const s1 = synthesizeSensors(truth1, { ...defaultSensorOpts, seed: 91 });
    const r1 = processDrive({ gps: s1.gps, motion: s1.motion, events: [{ t: 0, type: 'start' }], course: null });
    const course = r1.course!;
    const ref = r1.bestLap!;
    const k = 0.97;
    const truth2 = simulateDrive(oval, scaled(k));
    const s2 = synthesizeSensors(truth2, { ...defaultSensorOpts, seed: 94 });
    const p = new LivePipeline({ course, ref: { trace: ref.trace, lapTimeMs: ref.lapTimeMs, sectorTimesMs: ref.sectorTimesMs } });
    const snaps = replay(p, s2.gps, s2.motion, truth2.t.at(-1)! * 1000);
    const posErr: number[] = [];
    const sErr: number[] = [];
    for (const x of snaps) {
      const st = x.state;
      if (!x.ghost || !st || st.lapElapsedMs === null || st.lapNo === 0 || st.lapElapsedMs >= ref.lapTimeMs) continue;
      const tr = truthAt(truth1, (ref.startT + st.lapElapsedMs) / 1000);
      const ll = fromLocal(s1.origin, tr.x, tr.y);
      const want = toLocal(course.origin, ll.lat, ll.lon);
      posErr.push(Math.hypot(x.ghost.x - want.x, x.ghost.y - want.y));
      // 코스 거리: 정답 위치에서 랩 시작 위치까지 정답 거리 차이 (오벌 한 바퀴 안)
      const tr0 = truthAt(truth1, ref.startT / 1000);
      let ds = tr.s - tr0.s;
      if (ds < 0) ds += oval.length;
      sErr.push(x.ghost.s - ds);
    }
    const rms = (a: number[]) => Math.sqrt(a.reduce((m, e) => m + e * e, 0) / a.length);
    expect(posErr.length).toBeGreaterThan(500);
    // 측정값(2026-11-12): 위치 RMS 2.5 m·최대 4.5 m, 코스 거리 RMS 1.7 m
    expect(rms(posErr)).toBeLessThan(4);
    expect(Math.max(...posErr)).toBeLessThan(8);
    expect(rms(sErr)).toBeLessThan(3);
  });
});

describe('GPS가 속도·진행 방향 값을 주지 않는 기기 (일부 안드로이드, PC 브라우저)', () => {
  for (const [name, useMotion] of [
    ['모션 없음', false],
    ['모션 있음', true],
  ] as const) {
    it(`${name}: 위치 이동으로 방향을 구해 주행 중 위치가 발산하지 않는다 (RMS < 10 m, 값이 있으면 약 4 m)`, async () => {
      const { truthAt } = await import('../../generators');
      const { toLocal } = await import('../../../src/engine/geo');
      const truth = simulateDrive(oval, { ...base, laps: 2 });
      const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 5, speedNull: true, headingNull: true });
      const p = new LivePipeline({ course: null, ref: null });
      const snaps = replay(p, s.gps, useMotion ? s.motion : [], truth.t.at(-1)! * 1000);
      const o = toLocal(s.origin, s.gps[0]!.lat, s.gps[0]!.lon);
      const errs = snaps
        .filter((x) => x.pos && x.state && x.t > 3000)
        .map((x) => {
          const tr = truthAt(truth, x.state!.t / 1000);
          return Math.hypot(x.pos!.x + o.x - tr.x, x.pos!.y + o.y - tr.y);
        });
      // 고치기 전에는 방향을 잃고 RMS 77 m로 발산했다
      expect(Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length)).toBeLessThan(10);
    });
  }
});
