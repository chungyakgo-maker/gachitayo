import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors } from '../generators';
import { resampleMotion } from '../../src/normalize/resample';
import { LiveMotion50 } from '../../src/normalize/liveMotion';
import { MountCalibrator } from '../../src/normalize/mount';
import { prepareGps } from '../../src/engine/fusion/gpsObs';
import { rotationAngle } from '../../src/engine/linalg';

const truth = simulateDrive(stadiumTrack(), { laps: 1, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });

describe('주행 중 50 Hz 재샘플링 (늘어나는 Motion50)', () => {
  it('샘플을 하나씩 넣어도 일괄 재샘플링과 같은 값 (끊김·회전 값 빠짐 포함)', () => {
    const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 5, motionGaps: [[20, 20.5]] });
    // 회전 값이 가끔 빠지는 기기
    const motion = s.motion.map((m, i) => (i % 97 === 0 ? { ...m, rx: null, ry: null, rz: null } : m));
    const batch = resampleMotion(motion, { accel: -1, gyro: 1 });
    const live = new LiveMotion50({ accel: -1, gyro: 1 });
    for (const m of motion) live.push(m);
    expect(live.t0).toBe(batch.t0);
    expect(live.n).toBe(batch.n);
    expect(live.hasGyro).toBe(batch.hasGyro);
    for (const k of ['fx', 'fy', 'fz', 'wx', 'wy', 'wz', 'valid', 'gyroValid'] as const) {
      const a = live[k];
      const b = batch[k];
      for (let i = 0; i < batch.n; i++) expect(a[i], `${k}[${i}]`).toBeCloseTo(b[i]!, 12);
    }
  });

  it('주행 중 보정기가 늘어나는 Motion50을 따라가며 보정을 끝낸다', () => {
    const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 6 });
    const obs = prepareGps(s.gps, s.origin);
    const live = new LiveMotion50();
    const cal = new MountCalibrator(live);
    let j = 0;
    let done = 0;
    for (const m of s.motion) {
      live.push(m);
      for (; done < live.n; done++) {
        const t = live.t0 + done * live.dt;
        while (j < obs.length && obs[j]!.t <= t) cal.pushGps(obs[j++]!);
        cal.pushMotion(done);
      }
    }
    expect(cal.state).toBe('calibrated');
    expect(rotationAngle(cal.current!.R, s.mounts[0]!.R) * (180 / Math.PI)).toBeLessThan(2);
  });
});
