import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, truthAt, type SensorOpts } from '../generators';
import { processSession, type SmoothedTrack } from '../../src/engine/fusion/processSession';
import { toLocal } from '../../src/engine/geo';
import { wrapAngle } from '../../src/engine/linalg';

const truth = simulateDrive(stadiumTrack(), {
  laps: 2,
  startStopS: 5,
  endStopS: 3,
  vMax: 40,
  aLatMax: 8,
  aAccel: 3,
  aBrake: 6,
});

function errors(track: SmoothedTrack, origin: { lat: number; lon: number }, s: ReturnType<typeof synthesizeSensors>) {
  // 같은 원점 좌표로 비교하기 위해 정답을 생성기 원점에서 세션 원점으로 옮긴다
  const shift = toLocal(origin, s.origin.lat, s.origin.lon);
  const out: Array<{ t: number; pos: number; v: number }> = [];
  for (let k = 0; k < track.n; k++) {
    const t = track.t0 + k * track.dt;
    const tr = truthAt(truth, t / 1000);
    out.push({
      t,
      pos: Math.hypot(track.x[k]! - (tr.x + shift.x), track.y[k]! - (tr.y + shift.y)),
      v: Math.abs(track.v[k]! - tr.v),
    });
  }
  return out;
}

const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

function run(opts: Partial<SensorOpts> = {}) {
  const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 31, ...opts });
  const r = processSession({ gps: s.gps, motion: s.motion });
  return { s, r, smooth: errors(r.track, r.origin, s), filt: errors(r.filtered, r.origin, s) };
}

describe('RTS 스무더와 세션 처리 (사양서 7.3 주행 후)', () => {
  it('스무더가 필터보다 위치·속도 오차가 작다', () => {
    const { smooth, filt } = run();
    expect(rms(smooth.map((e) => e.pos))).toBeLessThan(rms(filt.map((e) => e.pos)));
    expect(rms(smooth.map((e) => e.v))).toBeLessThan(rms(filt.map((e) => e.v)));
  });

  it('목표: 스무더 위치 오차 RMS < 2 m, 속도 오차 RMS < 0.3 m/s (초기 목표)', () => {
    const { smooth } = run();
    expect(rms(smooth.map((e) => e.pos))).toBeLessThan(2);
    expect(rms(smooth.map((e) => e.v))).toBeLessThan(0.3);
  });

  it('8초 끊김 구간의 최대 오차가 필터보다 작다', () => {
    const { smooth, filt } = run({ dropouts: [[70, 78]] });
    const maxIn = (e: typeof smooth) => Math.max(...e.filter((x) => x.t >= 70_000 && x.t <= 79_000).map((x) => x.pos));
    expect(maxIn(smooth)).toBeLessThan(maxIn(filt));
  });

  it('진행 방향이 끊기지 않는다 (±180° 경계 포함)', () => {
    const { r } = run();
    let maxJump = 0;
    for (let k = 1; k < r.track.n; k++) maxJump = Math.max(maxJump, Math.abs(wrapAngle(r.track.psi[k]! - r.track.psi[k - 1]!)));
    expect(maxJump).toBeLessThan(0.1);
  });

  it('가속도 부호가 뒤집힌 기기(아이폰 흉내)를 판별해서 고치고, 정확도를 유지한다', () => {
    const { r, smooth } = run({ accelSign: -1 });
    expect(r.axisSigns).toMatchObject({ accel: -1, gyro: 1 });
    expect(r.gpsOnly).toBe(false);
    expect(rms(smooth.map((e) => e.pos))).toBeLessThan(2);
  });

  it('GPS 속도 값이 없는 기기는 "속도 품질 낮음"으로 표시한다 (사양서 6.3)', () => {
    expect(run({ speedNull: true }).r.speedQualityLow).toBe(true);
    expect(run().r.speedQualityLow).toBe(false);
  });

  it('모션이 없으면 GPS만 모드로 처리한다', () => {
    const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 32 });
    const r = processSession({ gps: s.gps, motion: [] });
    expect(r.gpsOnly).toBe(true);
    expect(r.track.n).toBeGreaterThan(1000);
  });

  it('GPS만 모드에서 20초 끊겨도 돌아온 GPS를 받아들이고, 끊김 뒤에는 바로 정상으로 돌아온다', () => {
    const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 33, dropouts: [[60, 80]] });
    const r = processSession({ gps: s.gps, motion: [] });
    const e = errors(r.track, r.origin, s);
    const f = errors(r.filtered, r.origin, s);
    const inGap = Math.max(...e.filter((x) => x.t >= 60_000 && x.t <= 80_000).map((x) => x.pos));
    const after = Math.max(...f.filter((x) => x.t >= 83_000 && x.t <= 90_000).map((x) => x.pos));
    expect(inGap).toBeLessThan(150);
    expect(after).toBeLessThan(15);
  });
});
