import { describe, expect, it } from 'vitest';
import {
  closeParallelTrack,
  defaultSensorOpts,
  simulateDrive,
  stadiumTrack,
  synthesizeSensors,
  truthAt,
  type SensorOpts,
} from '../generators';
import { resampleMotion } from '../../src/normalize/resample';
import { prepareGps } from '../../src/engine/fusion/gpsObs';
import {
  MountCalibrator,
  calibrateSession,
  detectAxisSigns,
  toCar,
} from '../../src/normalize/mount';
import { angleBetween, rotationAngle, row, type Vec3 } from '../../src/engine/linalg';

const DEG = 180 / Math.PI;
// 직선이 있는 오벌: 사양서 7.2의 앞 방향은 직진 중 가속·제동 구간에서 구한다
const circuit = simulateDrive(stadiumTrack(), {
  laps: 1,
  startStopS: 5,
  endStopS: 3,
  vMax: 40,
  aLatMax: 8,
  aAccel: 3,
  aBrake: 6,
});

function prepare(truth = circuit, opts: Partial<SensorOpts> = {}) {
  const s = synthesizeSensors(truth, { ...defaultSensorOpts, ...opts });
  return { ...s, m50: resampleMotion(s.motion), obs: prepareGps(s.gps, s.origin) };
}

describe('거치 보정 (사양서 7.2)', () => {
  const mounts: Array<[number, number, number]> = [
    [0, 0, 0],
    [20, -70, 5],
    [-135, 30, -15],
    [90, -85, 0],
    [200, 10, 170],
  ];
  for (const e of mounts) {
    it(`거치 각도 [${e.join(', ')}]를 2° 안으로 복원한다 (위 방향은 1° 안)`, () => {
      const d = prepare(circuit, { seed: 11, mountEulerDeg: e });
      const { segments } = calibrateSession(d.m50, d.obs);
      const cal = segments[0]!.cal;
      expect(cal).not.toBeNull();
      expect(rotationAngle(cal!.R, d.mount) * DEG).toBeLessThan(2);
      expect(angleBetween(row(cal!.R, 2), row(d.mount, 2)) * DEG).toBeLessThan(1);
    });
  }

  it('실시간: 정차로 위 방향을 잡고, 가속 구간이 있어야 보정을 끝낸다', () => {
    const d = prepare(circuit, { seed: 12 });
    const c = new MountCalibrator(d.m50);
    let j = 0;
    const states: Record<number, string> = {};
    for (let i = 0; i < d.m50.n; i++) {
      const t = d.m50.t0 + i * d.m50.dt;
      while (j < d.obs.length && d.obs[j]!.t <= t) c.pushGps(d.obs[j++]!);
      c.pushMotion(i);
      if (t === 2000 || t === 4500) states[t] = c.state;
    }
    // 3초 정차 창이 차기 전에는 정차를 기다리고, 정차 뒤 출발 전에는 가속 구간을 기다린다
    expect(states[2000]).toBe('need_stationary');
    expect(states[4500]).toBe('need_forward');
    expect(c.state).toBe('calibrated');
    expect(c.events[0]!.type).toBe('calibration');
    expect(c.events[0]!.t).toBeGreaterThan(5000);
  });

  it('정차만 하고 가속 구간이 없으면 앞 방향을 정하지 않는다', () => {
    const d = prepare(circuit, { seed: 13 });
    const cut = { ...d, motion: d.motion.filter((m) => m.t < 4900), gps: d.gps.filter((g) => g.tRecv < 4900) };
    const m50 = resampleMotion(cut.motion);
    const obs = prepareGps(cut.gps, d.origin);
    const { segments } = calibrateSession(m50, obs);
    expect(segments[0]!.cal).toBeNull();
  });

  it('긴 제동(0.8 g)과 긴 코너에서는 재보정하지 않는다', () => {
    const truth = simulateDrive(closeParallelTrack(), {
      laps: 2,
      startStopS: 5,
      endStopS: 3,
      vMax: 40,
      aLatMax: 8,
      aAccel: 3,
      aBrake: 8,
    });
    const d = prepare(truth, { seed: 14 });
    const { events } = calibrateSession(d.m50, d.obs);
    expect(events.filter((e) => e.type === 'recalibration')).toEqual([]);
  });

  it('주행 중 거치가 20° 돌아가면 3초 안에 재보정 이벤트를 남기고, 다음 정차 뒤 새 각도를 2° 안으로 복원한다', () => {
    const truth = simulateDrive(stadiumTrack(), {
      laps: 2,
      startStopS: 5,
      endStopS: 5,
      lapStopS: 6,
      vMax: 40,
      aLatMax: 8,
      aAccel: 3,
      aBrake: 6,
    });
    const changeAt = 30;
    const d = prepare(truth, {
      seed: 15,
      mountEulerDeg: [20, -70, 5],
      mountChanges: [{ atS: changeAt, eulerDeg: [40, -70, 5] }],
    });
    const { segments, events } = calibrateSession(d.m50, d.obs);
    const recal = events.filter((e) => e.type === 'recalibration');
    expect(recal).toHaveLength(1);
    expect(recal[0]!.t).toBeGreaterThan(changeAt * 1000);
    expect(recal[0]!.t).toBeLessThan(changeAt * 1000 + 3500);
    expect(segments).toHaveLength(2);
    const newMount = d.mounts[1]!.R;
    expect(segments[1]!.cal).not.toBeNull();
    expect(rotationAngle(segments[1]!.cal!.R, newMount) * DEG).toBeLessThan(2);
  });

  it('차 축으로 바꾼 앞뒤·좌우 가속도가 정답과 맞는다 (0.2초 평균, RMS < 0.3 m/s²)', () => {
    const d = prepare(circuit, { seed: 16 });
    const cal = calibrateSession(d.m50, d.obs).segments[0]!.cal!;
    const win = 10;
    let se = 0;
    let n = 0;
    for (let i = win; i < d.m50.n; i += 5) {
      let ax = 0;
      let ay = 0;
      let tx = 0;
      let ty = 0;
      for (let k = i - win + 1; k <= i; k++) {
        const f: Vec3 = [d.m50.fx[k]!, d.m50.fy[k]!, d.m50.fz[k]!];
        const w: Vec3 = [d.m50.wx[k]!, d.m50.wy[k]!, d.m50.wz[k]!];
        const c = toCar(cal, f, w);
        const tr = truthAt(circuit, (d.m50.t0 + k * d.m50.dt) / 1000);
        ax += c.ax;
        ay += c.ay;
        tx += tr.aLong;
        ty += tr.aLat;
      }
      se += ((ax - tx) / win) ** 2 + ((ay - ty) / win) ** 2;
      n += 2;
    }
    expect(Math.sqrt(se / n)).toBeLessThan(0.3);
  });
});

describe('플랫폼 축 부호 판별', () => {
  const cases: Array<[1 | -1, 1 | -1]> = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (const [accel, gyro] of cases) {
    it(`가속도 ${accel}, 자이로 ${gyro}`, () => {
      const d = prepare(circuit, { seed: 17, accelSign: accel, gyroSign: gyro });
      const cal = calibrateSession(d.m50, d.obs).segments[0]!.cal!;
      const r = detectAxisSigns(d.m50, d.obs, cal);
      expect(r).toEqual({ accel, gyro, confidence: 'high' });
    });
  }
});
