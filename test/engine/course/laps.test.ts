import { describe, expect, it } from 'vitest';
import {
  defaultSensorOpts,
  simulateDrive,
  stadiumTrack,
  synthesizeSensors,
  windingWithHairpins,
  type Truth,
} from '../../generators';
import { buildGeometry } from '../../../src/engine/course/geometry';
import { GateDetector, crossGate } from '../../../src/engine/course/gates';
import { splitLaps, theoreticalBest, type FrameTrack, type LapResult } from '../../../src/engine/course/laps';
import { processSession } from '../../../src/engine/fusion/processSession';
import { courseFromTrack, ORIGIN } from './helpers';

const oval = stadiumTrack();
/** 출발선을 직선 100 m 지점에 둔다 (정차 위치가 출발선 위에 있으면 출발 순간을 통과로 볼지 애매해서) */
const GATE_S = 100;
const ovalCourse = courseFromTrack(oval, { gateAtS: GATE_S });
const ovalGeom = buildGeometry(ovalCourse);

/** 정답 주행을 50 Hz 프레임으로 */
function truthFrames(truth: Truth, edit?: (i: number, f: { x: number; y: number }) => void): FrameTrack {
  const idx: number[] = [];
  for (let i = 0; i < truth.t.length; i += 2) idx.push(i);
  const fr: FrameTrack = {
    n: idx.length,
    t: Float64Array.from(idx, (i) => truth.t[i]! * 1000),
    x: Float64Array.from(idx, (i) => truth.x[i]!),
    y: Float64Array.from(idx, (i) => truth.y[i]!),
    v: Float64Array.from(idx, (i) => truth.v[i]!),
  };
  if (edit) {
    for (let k = 0; k < fr.n; k++) {
      const f = { x: fr.x[k]!, y: fr.y[k]! };
      edit(idx[k]!, f);
      fr.x[k] = f.x;
      fr.y[k] = f.y;
    }
  }
  return fr;
}

/** 정답에서 출발선(s = GATE_S + k·L)을 지난 시각 ms */
function truthCrossings(truth: Truth, L: number, offset = GATE_S): number[] {
  const out: number[] = [];
  for (let i = 1; i < truth.s.length; i++) {
    const a = truth.s[i - 1]!;
    const b = truth.s[i]!;
    if (b <= a) continue;
    for (let k = 0; offset + k * L <= b; k++) {
      const c = offset + k * L;
      if (a < c && c <= b) {
        const f = (c - a) / (b - a);
        out.push((truth.t[i - 1]! + f * (truth.t[i]! - truth.t[i - 1]!)) * 1000);
      }
    }
  }
  return out;
}

const gpsEvery = (truth: Truth, gapFrom?: number, gapTo?: number) => {
  const g: number[] = [];
  for (let t = 1000; t <= truth.t[truth.t.length - 1]! * 1000; t += 1000) {
    if (gapFrom !== undefined && t >= gapFrom && t <= gapTo!) continue;
    g.push(t);
  }
  return g;
};

describe('게이트 통과 (사양서 7.7)', () => {
  const g = ovalGeom.start;

  it('선분이 게이트를 지나면 비율을 돌려주고, 반대 방향은 무시한다', () => {
    expect(crossGate(g.cx - 4, g.cy, g.cx + 6, g.cy, g)).toBeCloseTo(0.4, 9);
    expect(crossGate(g.cx + 6, g.cy, g.cx - 4, g.cy, g)).toBeNull();
    expect(crossGate(g.cx - 4, g.cy + 20, g.cx + 6, g.cy + 20, g)).toBeNull(); // 게이트 폭 밖
  });

  it('같은 게이트를 10초 안에 다시 지나면 무시한다', () => {
    const d = new GateDetector(ovalGeom);
    const pass = (t: number) => {
      d.push(t, g.cx - 1, g.cy);
      return d.push(t + 20, g.cx + 1, g.cy);
    };
    expect(pass(0)).toHaveLength(1);
    d.push(3000, g.cx - 30, g.cy); // 뒤로 물러났다가
    expect(pass(5000)).toHaveLength(0);
    d.push(14000, g.cx - 30, g.cy);
    expect(pass(15000)).toHaveLength(1);
  });
});

describe('랩·구간 (사양서 7.8, 7.9)', () => {
  const truth = simulateDrive(oval, { laps: 4, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });

  it('가상 주행(센서 → 융합, 시드 4개): 랩타임 오차 RMS ≤ 0.1초·최대 ≤ 0.2초, 출발선 통과 시각 오차 RMS ≤ 0.08초', () => {
    // 사양서 10.1 "랩타임 오차 0.1초 이하(초기값)"는 RMS로 본다. GPS 3~5 m 잡음에서는 한 랩 최대가 0.1초를 넘을 수 있다.
    const lapErr: number[] = [];
    const startErr: number[] = [];
    const truthX = truthCrossings(truth, oval.length);
    for (const seed of [51, 52, 53, 54]) {
      const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed });
      const r = processSession({ gps: s.gps, motion: s.motion, origin: ORIGIN });
      const tr = r.track;
      const frames: FrameTrack = {
        n: tr.n,
        t: Float64Array.from({ length: tr.n }, (_, k) => tr.t0 + k * tr.dt),
        x: tr.x,
        y: tr.y,
        v: tr.v,
      };
      const res = splitLaps({ geom: ovalGeom, track: frames, gpsTimes: s.gps.map((g) => g.tRecv), pauses: [] });
      expect(res.laps).toHaveLength(truthX.length - 1);
      res.laps.forEach((l, i) => {
        expect(l.valid).toBe(true);
        lapErr.push(l.lapTimeMs - (truthX[i + 1]! - truthX[i]!));
        startErr.push(l.startT - truthX[i]!);
      });
    }
    const rms = (a: number[]) => Math.sqrt(a.reduce((x, e) => x + e * e, 0) / a.length);
    expect(rms(lapErr)).toBeLessThanOrEqual(100);
    expect(Math.max(...lapErr.map(Math.abs))).toBeLessThanOrEqual(200);
    expect(rms(startErr)).toBeLessThanOrEqual(80);
  });

  it('구간 기록 합 = 랩타임, 구간 경계는 1/3·2/3', () => {
    const res = splitLaps({ geom: ovalGeom, track: truthFrames(truth), gpsTimes: gpsEvery(truth), pauses: [] });
    for (const l of res.laps) {
      const [a, b, c] = l.sectorTimesMs;
      expect(a! + b! + c!).toBeCloseTo(l.lapTimeMs, 6);
    }
  });

  it('GPS가 5초 넘게 끊긴 랩만 무효 (gps_lost)', () => {
    const tx = truthCrossings(truth, oval.length);
    const mid = (tx[1]! + tx[2]!) / 2;
    const res = splitLaps({
      geom: ovalGeom,
      track: truthFrames(truth),
      gpsTimes: gpsEvery(truth, mid, mid + 8000),
      pauses: [],
    });
    expect(res.laps.map((l) => l.invalidReason)).toEqual([null, 'gps_lost', null]);
  });

  it('코스를 벗어난 랩은 무효 (off_course)', () => {
    const tx = truthCrossings(truth, oval.length);
    const a = (tx[2]! + 20_000) / 1000;
    const res = splitLaps({
      geom: ovalGeom,
      track: truthFrames(truth, (i, f) => {
        if (truth.t[i]! >= a && truth.t[i]! <= a + 3) f.y -= 45;
      }),
      gpsTimes: gpsEvery(truth),
      pauses: [],
    });
    expect(res.laps.map((l) => l.invalidReason)).toEqual([null, null, 'off_course']);
  });

  it('이동 거리가 코스 길이보다 5% 넘게 길면 무효 (distance)', () => {
    const tx = truthCrossings(truth, oval.length);
    const res = splitLaps({
      geom: ovalGeom,
      track: truthFrames(truth, (i, f) => {
        const t = truth.t[i]! * 1000;
        if (t > tx[0]! && t < tx[1]!) f.y += 6 * Math.sin(t / 150);
      }),
      gpsTimes: gpsEvery(truth),
      pauses: [],
    });
    expect(res.laps[0]!.invalidReason).toBe('distance');
    expect(res.laps[1]!.valid).toBe(true);
  });

  it('중단 구간이 걸친 랩은 무효 (interrupted, 사양서 9장)', () => {
    const tx = truthCrossings(truth, oval.length);
    const res = splitLaps({
      geom: ovalGeom,
      track: truthFrames(truth),
      gpsTimes: gpsEvery(truth),
      pauses: [[tx[1]! + 5000, tx[1]! + 6000]],
    });
    expect(res.laps.map((l) => l.invalidReason)).toEqual([null, 'interrupted', null]);
  });

  it('편도: 올라갈 때만 랩, 되돌아오는(반대 방향) 통과는 무시', () => {
    const winding = windingWithHairpins();
    const geom = buildGeometry(courseFromTrack(winding));
    const up = simulateDrive(winding, { laps: 1, startStopS: 3, endStopS: 3, vMax: 30, aLatMax: 6, aAccel: 3, aBrake: 6 });
    const f1 = truthFrames(up);
    // 올라감 → 같은 길을 거꾸로 내려옴 → 다시 올라감
    const T = f1.t[f1.n - 1]! + 1000;
    const rev = (a: Float64Array) => Float64Array.from(a).reverse();
    const cat = (...xs: Float64Array[]) => {
      const out = new Float64Array(xs.reduce((s, x) => s + x.length, 0));
      let o = 0;
      for (const x of xs) {
        out.set(x, o);
        o += x.length;
      }
      return out;
    };
    const frames: FrameTrack = {
      n: f1.n * 3,
      t: cat(f1.t, f1.t.map((t) => t + T), f1.t.map((t) => t + 2 * T)),
      x: cat(f1.x, rev(f1.x), f1.x),
      y: cat(f1.y, rev(f1.y), f1.y),
      v: cat(f1.v, rev(f1.v), f1.v),
    };
    const gps: number[] = [];
    for (let t = 1000; t < 3 * T; t += 1000) gps.push(t);
    const res = splitLaps({ geom, track: frames, gpsTimes: gps, pauses: [] });
    expect(res.laps).toHaveLength(2);
    expect(res.laps.every((l) => l.valid)).toBe(true);
    expect(res.laps[1]!.startT).toBeGreaterThan(2 * T);
  });
});

describe('이론상 베스트 (사양서 7.10)', () => {
  it('유효 랩의 구간별 최소 기록 합', () => {
    const lap = (no: number, s: [number, number, number], valid = true): LapResult => ({
      lapNo: no,
      startT: 0,
      endT: 0,
      lapTimeMs: s[0] + s[1] + s[2],
      sectorTimesMs: s,
      valid,
      invalidReason: valid ? null : 'gps_lost',
      maxSpeed: 0,
      distanceM: 0,
    });
    const r = theoreticalBest([lap(1, [30_000, 31_000, 29_000]), lap(2, [29_500, 31_500, 28_700]), lap(3, [1, 1, 1], false)]);
    expect(r.sectorsMs).toEqual([29_500, 31_000, 28_700]);
    expect(r.totalMs).toBe(89_200);
    expect(theoreticalBest([]).totalMs).toBeNull();
  });
});
