import { describe, expect, it } from 'vitest';
import { ellipseTrack, segmentTrack, closeParallelTrack, windingWithHairpins } from '../../src/sim/track';
import { simulateDrive, truthAt } from '../../src/sim/drive';
import { synthesizeSensors, defaultSensorOpts } from '../../src/sim/sensors';
import { mulberry32 } from '../../src/sim/random';
import { matVec, transpose } from '../../src/engine/linalg';
import { toLocal } from '../../src/engine/geo';

describe('코스 모양', () => {
  it('타원 둘레는 라마누잔 근사와 0.1% 안에서 같다', () => {
    const a = 300;
    const b = 150;
    const h = ((a - b) / (a + b)) ** 2;
    const ramanujan = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    const t = ellipseTrack(a, b);
    expect(t.closed).toBe(true);
    expect(Math.abs(t.length - ramanujan) / ramanujan).toBeLessThan(0.001);
  });

  it('직선 100 m 뒤 반지름 50 m 왼쪽 90° 원호의 끝점과 방향', () => {
    const t = segmentTrack([{ straight: 100 }, { arc: 50, angleDeg: 90 }]);
    const end = t.pointAt(t.length);
    expect(end.x).toBeCloseTo(150, 0);
    expect(end.y).toBeCloseTo(50, 0);
    expect(end.psi).toBeCloseTo(Math.PI / 2, 2);
    expect(t.pointAt(120).curvature).toBeCloseTo(1 / 50, 6);
  });

  it('헤어핀 와인딩은 편도, 근접 평행 코스는 닫힌 코스', () => {
    expect(windingWithHairpins().closed).toBe(false);
    const c = closeParallelTrack();
    expect(c.closed).toBe(true);
    const start = c.pointAt(0);
    const end = c.pointAt(c.length);
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(0.5);
  });
});

describe('주행 시뮬레이션', () => {
  const track = ellipseTrack(300, 150);
  const opts = { laps: 2, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };
  const truth = simulateDrive(track, opts);

  it('가속·제동·횡가속도 한계를 넘지 않는다', () => {
    const max = (a: Float64Array) => a.reduce((m, v) => Math.max(m, v), -Infinity);
    const min = (a: Float64Array) => a.reduce((m, v) => Math.min(m, v), Infinity);
    expect(max(truth.aLong)).toBeLessThanOrEqual(3 * 1.05);
    expect(min(truth.aLong)).toBeGreaterThanOrEqual(-6 * 1.05);
    expect(max(truth.aLat.map(Math.abs))).toBeLessThanOrEqual(8 * 1.05);
  });

  it('처음과 끝은 정차해 있고, 달린 거리는 바퀴 수 × 둘레', () => {
    expect(truthAt(truth, 2).v).toBe(0);
    expect(truthAt(truth, truth.t[truth.t.length - 1]! - 1).v).toBe(0);
    expect(truth.s[truth.s.length - 1]).toBeCloseTo(2 * track.length, 0);
  });

  it('횡가속도 = v²·곡률, 요레이트 = v·곡률', () => {
    const k = Math.floor(truth.t.length / 3);
    const p = track.pointAt(truth.s[k]! % track.length);
    expect(truth.aLat[k]).toBeCloseTo(truth.v[k]! ** 2 * p.curvature, 6);
    expect(truth.yawRate[k]).toBeCloseTo(truth.v[k]! * p.curvature, 6);
  });
});

describe('센서 합성', () => {
  const truth = simulateDrive(ellipseTrack(300, 150), {
    laps: 1,
    startStopS: 5,
    endStopS: 3,
    vMax: 40,
    aLatMax: 8,
    aAccel: 3,
    aBrake: 6,
  });

  it('GPS 잡음 RMS가 설정값 근처이고, 끊김 구간에는 GPS가 없다', () => {
    const out = synthesizeSensors(truth, {
      ...defaultSensorOpts,
      seed: 1,
      gpsNoiseM: 4,
      gpsDriftM: 0,
      outlierRate: 0,
      dropouts: [[30, 38]],
    });
    let se = 0;
    for (const g of out.gps) {
      const p = toLocal(out.origin, g.lat, g.lon);
      const tr = truthAt(truth, g.tRecv / 1000);
      se += (p.x - tr.x) ** 2 + (p.y - tr.y) ** 2;
    }
    const rmsPerAxis = Math.sqrt(se / out.gps.length / 2);
    expect(rmsPerAxis).toBeGreaterThan(3.2);
    expect(rmsPerAxis).toBeLessThan(4.8);
    expect(out.gps.some((g) => g.tRecv > 30_000 && g.tRecv < 38_000)).toBe(false);
  });

  it('기기 축 모션을 정답 거치 행렬로 돌리면 차 축 가속도가 된다', () => {
    const out = synthesizeSensors(truth, {
      ...defaultSensorOpts,
      seed: 2,
      accelNoise: 0,
      accelBias: [0, 0, 0],
      gyroNoise: 0,
      gyroBias: [0, 0, 0],
      mountEulerDeg: [37, -65, 12],
    });
    const m = out.motion[Math.floor(out.motion.length / 2)]!;
    const car = matVec(out.mount, [m.gax, m.gay, m.gaz]);
    const tr = truthAt(truth, m.t / 1000);
    expect(car[0]).toBeCloseTo(tr.aLong, 6);
    expect(car[1]).toBeCloseTo(tr.aLat, 6);
    expect(car[2]).toBeCloseTo(9.80665, 6);
    const w = matVec(out.mount, [m.rx!, m.ry!, m.rz!]);
    expect(w[2]).toBeCloseTo(tr.yawRate, 6);
    // 거치 행렬은 회전 행렬 (전치 = 역행렬)
    const I = matVec(transpose(out.mount), car);
    expect(I[0]).toBeCloseTo(m.gax, 6);
  });

  it('가속도 부호 뒤집힘(아이폰 흉내)과 자이로 없음', () => {
    const base = { ...defaultSensorOpts, seed: 3, accelNoise: 0, accelBias: [0, 0, 0] as [number, number, number] };
    const a = synthesizeSensors(truth, base).motion[10]!;
    const b = synthesizeSensors(truth, { ...base, accelSign: -1, noGyro: true }).motion[10]!;
    expect(b.gax).toBeCloseTo(-a.gax, 9);
    expect(b.rx).toBeNull();
  });

  it('같은 시드면 같은 결과', () => {
    const a = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 9 });
    const b = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 9 });
    expect(a.gps).toEqual(b.gps);
    expect(a.motion.slice(0, 50)).toEqual(b.motion.slice(0, 50));
    const r = mulberry32(5);
    const r2 = mulberry32(5);
    expect([r(), r(), r()]).toEqual([r2(), r2(), r2()]);
  });
});
