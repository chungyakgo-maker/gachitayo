import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, truthAt, type SensorOpts, type Truth } from '../generators';
import { resampleMotion } from '../../src/normalize/resample';
import { prepareGps } from '../../src/engine/fusion/gpsObs';
import { calibrateSession } from '../../src/normalize/mount';
import { FusionRunner, type FusedPoint } from '../../src/engine/fusion/forward';
import { toLocal } from '../../src/engine/geo';

const truth = simulateDrive(stadiumTrack(), {
  laps: 2,
  startStopS: 5,
  endStopS: 3,
  vMax: 40,
  aLatMax: 8,
  aAccel: 3,
  aBrake: 6,
});

function run(opts: Partial<SensorOpts> = {}, t: Truth = truth) {
  const s = synthesizeSensors(t, { ...defaultSensorOpts, seed: 21, ...opts });
  const m50 = resampleMotion(s.motion);
  const obs = prepareGps(s.gps, s.origin);
  const { segments } = calibrateSession(m50, obs);
  const runner = new FusionRunner({
    m50,
    gps: obs,
    calibrationAt: (tt) => segments.find((g) => tt >= g.tStart && tt <= g.tEnd)?.cal ?? null,
  });
  const points: FusedPoint[] = [];
  const tEnd = t.t[t.t.length - 1]! * 1000;
  for (let tt = 0; tt <= tEnd; tt += 20) {
    runner.runTo(tt);
    const p = runner.current();
    if (p && p.t === tt) points.push(p);
  }
  const rawErr = s.gps.map((g) => {
    const p = toLocal(s.origin, g.lat, g.lon);
    const tr = truthAt(t, g.tRecv / 1000);
    return Math.hypot(p.x - tr.x, p.y - tr.y);
  });
  const err = points.map((p) => {
    const tr = truthAt(t, p.t / 1000);
    return { t: p.t, pos: Math.hypot(p.x - tr.x, p.y - tr.y), v: Math.abs(p.v - tr.v) };
  });
  const rms = (a: number[]) => Math.sqrt(a.reduce((s2, v) => s2 + v * v, 0) / a.length);
  return { points, err, rawRms: rms(rawErr), posRms: rms(err.map((e) => e.pos)), vRms: rms(err.map((e) => e.v)) };
}

describe('FusionRunner (주행 중 EKF)', () => {
  it('가상 서킷: 위치 오차가 GPS 원본보다 작고, 속도 오차 RMS < 0.5 m/s', () => {
    const r = run();
    expect(r.points.length).toBeGreaterThan(1000);
    expect(r.posRms).toBeLessThan(r.rawRms * 0.8);
    expect(r.vRms).toBeLessThan(0.5);
  });

  it('GPS 3초 끊김 중 최대 위치 오차 < 5 m, 8초 끊김 < 15 m', () => {
    const r = run({ dropouts: [[40, 43], [70, 78]] });
    const maxIn = (a: number, b: number) =>
      Math.max(...r.err.filter((e) => e.t >= a * 1000 && e.t <= b * 1000).map((e) => e.pos));
    expect(maxIn(40, 44)).toBeLessThan(5);
    expect(maxIn(70, 79)).toBeLessThan(15);
  });

  it('모션 권한이 없으면 GPS만으로 동작하고, 그래도 GPS 원본보다 낫다', () => {
    const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 22 });
    const m50 = resampleMotion([]);
    const obs = prepareGps(s.gps, s.origin);
    const runner = new FusionRunner({ m50, gps: obs, calibrationAt: () => null });
    let se = 0;
    let n = 0;
    for (let tt = 3000; tt <= truth.t[truth.t.length - 1]! * 1000; tt += 100) {
      runner.runTo(tt);
      const p = runner.current()!;
      expect(p.mode).toBe('gps_only');
      const tr = truthAt(truth, p.t / 1000);
      se += (p.x - tr.x) ** 2 + (p.y - tr.y) ** 2;
      n++;
    }
    const rawRms = run().rawRms;
    expect(Math.sqrt(se / n)).toBeLessThan(rawRms);
  });

  it('자이로가 없는 기기에서도 동작한다', () => {
    const r = run({ noGyro: true });
    expect(r.posRms).toBeLessThan(r.rawRms);
  });
});
