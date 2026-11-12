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
