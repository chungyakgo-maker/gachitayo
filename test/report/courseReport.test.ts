// 사양서 10.1 검증 항목 결과 (사람이 읽는 용도). REPORT=1일 때만 만든다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import {
  closeParallelTrack,
  defaultSensorOpts,
  simulateDrive,
  stadiumTrack,
  synthesizeSensors,
  windingWithHairpins,
  type DriveOpts,
  type Track,
  type Truth,
} from '../generators';
import { courseFromTrack } from '../engine/course/helpers';
import { processDrive } from '../../src/engine/process/processDrive';
import { processSession } from '../../src/engine/fusion/processSession';
import { buildGeometry } from '../../src/engine/course/geometry';
import { LiveEngine } from '../../src/engine/live/liveEngine';
import { refTimeAt } from '../../src/engine/delta/trace';

const OUT = process.env.REPORT_DIR ?? 'report-out';
const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** 정답에서 게이트(s = offset + k·L, 편도는 offset과 끝) 통과 시각 ms */
function crossings(truth: Truth, track: Track, offset: number, endS?: number): number[] {
  const marks: number[] = [];
  if (track.closed) for (let k = 0; offset + k * track.length <= truth.s[truth.s.length - 1]!; k++) marks.push(offset + k * track.length);
  else marks.push(offset, endS!);
  const out: number[] = [];
  for (const c of marks)
    for (let i = 1; i < truth.s.length; i++) {
      const a = truth.s[i - 1]!;
      const b = truth.s[i]!;
      if (b > a && a < c && c <= b) {
        out.push((truth.t[i - 1]! + ((c - a) / (b - a)) * (truth.t[i]! - truth.t[i - 1]!)) * 1000);
        break;
      }
    }
  return out;
}

describe.skipIf(!process.env.REPORT)('사양서 10.1 검증 결과', () => {
  it('랩타임·게이트·델타', () => {
    mkdirSync(OUT, { recursive: true });
    const rows: Record<string, unknown>[] = [];
    const cases: Array<[string, Track, DriveOpts, number]> = [
      ['오벌 서킷 (4바퀴)', stadiumTrack(), { laps: 4, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 }, 100],
      ['20 m 평행 코스 (4바퀴)', closeParallelTrack(), { laps: 4, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 8 }, 100],
      ['헤어핀 와인딩 편도 (출발선 20 m 지점)', windingWithHairpins(), { laps: 1, startStopS: 5, endStopS: 3, vMax: 30, aLatMax: 6, aAccel: 3, aBrake: 6 }, 20],
    ];
    for (const [name, track, opts, gateAt] of cases) {
      const course = courseFromTrack(track, { gateAtS: gateAt, startInsetM: 20 });
      const truth = simulateDrive(track, opts);
      const truthX = crossings(truth, track, gateAt, track.closed ? undefined : 20 + course.lengthM!);
      const lapErr: number[] = [];
      const gateErr: number[] = [];
      let invalid = 0;
      for (const seed of [101, 102, 103, 104, 105, 106]) {
        const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed });
        const r = processDrive({ gps: s.gps, motion: s.motion, events: [], course });
        r.laps.forEach((l, i) => {
          if (!l.valid) invalid++;
          lapErr.push(l.lapTimeMs - (truthX[i + 1]! - truthX[i]!));
          gateErr.push(l.startT - truthX[i]!, l.endT - truthX[i + 1]!);
        });
      }
      rows.push({
        항목: `랩타임 오차: ${name}`,
        '랩 수(시드 6개)': lapErr.length,
        'RMS 초': r3(rms(lapErr) / 1000),
        '최대 초': r3(Math.max(...lapErr.map(Math.abs)) / 1000),
        '게이트 통과 시각 RMS 초': r3(rms(gateErr) / 1000),
        '잘못 무효 처리된 랩': invalid,
      });
    }

    // 델타: 3% 느린 주행을 주행 중 엔진으로
    const oval = stadiumTrack();
    const base: DriveOpts = { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };
    const k = 0.97;
    const errs: number[] = [];
    for (const seed of [111, 112, 113]) {
      const t1 = simulateDrive(oval, base);
      const s1 = synthesizeSensors(t1, { ...defaultSensorOpts, seed });
      const first = processDrive({ gps: s1.gps, motion: s1.motion, events: [], course: null });
      const t2 = simulateDrive(oval, { ...base, vMax: 40 * k, aLatMax: 8 * k * k, aAccel: 3 * k * k, aBrake: 6 * k * k });
      const s2 = synthesizeSensors(t2, { ...defaultSensorOpts, seed: seed + 50 });
      const ref = first.bestLap!;
      const fused = processSession({ gps: s2.gps, motion: s2.motion, origin: first.course!.origin }).filtered;
      const live = new LiveEngine(buildGeometry(first.course!), { trace: ref.trace, lapTimeMs: ref.lapTimeMs });
      const byLap = new Map<number, number[]>();
      const times = new Map<number, number>();
      for (let i = 0; i < fused.n; i++) {
        const st = live.push({ t: fused.t0 + i * fused.dt, x: fused.x[i]!, y: fused.y[i]!, v: fused.v[i]!, sigmaPos: 2, ax: null, ay: null, gpsOk: true, gCalibrated: false });
        if (st.lastLap) times.set(st.lastLap.lapNo, st.lastLap.timeMs);
        if (st.delta !== null && st.s !== null)
          byLap.set(st.lapNo, [...(byLap.get(st.lapNo) ?? []), st.delta - (1 / k - 1) * refTimeAt(ref.trace, st.s, ref.lapTimeMs, first.course!.lengthM!)]);
      }
      for (const [no, ms] of times) if (Math.abs(ms - ref.lapTimeMs / k) < 0.02 * ref.lapTimeMs) errs.push(...(byLap.get(no) ?? []));
    }
    rows.push({ 항목: '델타 오차 (3% 느린 랩, 주행 중 엔진, 시드 3개)', '표본 수': errs.length, 'RMS 초': r3(rms(errs)), '최대 초': r3(Math.max(...errs.map(Math.abs))) });
    writeFileSync(`${OUT}/course-report.json`, JSON.stringify(rows, null, 1));
  });
});
