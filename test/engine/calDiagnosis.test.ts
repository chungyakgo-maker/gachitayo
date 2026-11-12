import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors } from '../generators';
import { calDiagnosisLines, diagnoseCalibration } from '../../src/engine/diagnose/calibration';

// 정차 5초 뒤 출발, 직선이 있는 오벌 한 바퀴
const drive = (aAccel: number, aBrake: number) =>
  simulateDrive(stadiumTrack(), { laps: 1, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel, aBrake });

describe('G 보정 진단 (실차 도구)', () => {
  it('보통 주행: 보정 끝, 정차 창·직진 가감속이 통과한다', () => {
    const s = synthesizeSensors(drive(3, 6), { ...defaultSensorOpts, seed: 3 });
    const d = diagnoseCalibration(s.gps, s.motion);
    expect(d.mount!.end.stage).toBe('done');
    expect(d.mount!.still.ok).toBeGreaterThan(0);
    expect(d.mount!.fwd.ok).toBeGreaterThanOrEqual(3);
    expect(d.motion.gaps).toBe(0);
    const lines = calDiagnosisLines(d);
    expect(lines[0]).toMatchObject({ label: '결과', bad: false });
    expect(lines[0]!.text).toMatch(/^보정 끝 \(출발 \d+초 뒤\)$/);
  });

  it('살살 가속: 0.15g 넘는 가감속이 없어 2단계에서 멈춘 것을 보여준다', () => {
    const s = synthesizeSensors(drive(0.9, 1.1), { ...defaultSensorOpts, seed: 4 });
    const d = diagnoseCalibration(s.gps, s.motion);
    expect(d.mount!.end.stage).toBe('forward');
    expect(d.mount!.fwd.strong).toBe(0);
    expect(d.mount!.fwd.weak).toBeGreaterThan(0);
    const lines = calDiagnosisLines(d);
    expect(lines[0]!.text).toBe('2단계 "직진 가감속"에서 멈춤 (0/3)');
    expect(lines.find((l) => l.label === '2 직진 가감속')!.text).toMatch(/^0\.15g 이상 0번 → 통과 0/);
  });

  it('동작 센서가 자주 끊기면 끊김 횟수와 정차 창의 "센서 끊김"으로 드러난다', () => {
    const s = synthesizeSensors(drive(3, 6), { ...defaultSensorOpts, seed: 5 });
    // 1초마다 0.3초씩 빠짐 (화면이 바빠 이벤트가 밀리는 경우를 흉내)
    const motion = s.motion.filter((m) => m.t % 1000 > 300);
    const d = diagnoseCalibration(s.gps, motion);
    expect(d.motion.gaps).toBeGreaterThan(10);
    expect(d.mount!.end.stage).toBe('stationary');
    expect(d.mount!.still.motionGap).toBeGreaterThan(0);
    expect(d.mount!.still.ok).toBe(0);
    expect(calDiagnosisLines(d).find((l) => l.label === '동작 센서')!.bad).toBe(true);
  });

  it('정차 중 GPS 점이 안 오면 "GPS 점 부족"으로 센다', () => {
    const s = synthesizeSensors(drive(3, 6), { ...defaultSensorOpts, seed: 6 });
    const t0 = s.gps[0]!.tRecv;
    // 처음 정차 5초 동안 첫 점 하나만 남긴다
    const gps = s.gps.filter((g, i) => i === 0 || g.tRecv - t0 > 5000);
    const d = diagnoseCalibration(gps, s.motion);
    expect(d.mount!.still.fewFixes).toBeGreaterThan(0);
  });

  it('동작 센서 값이 없으면 그렇다고 알려준다', () => {
    const s = synthesizeSensors(drive(3, 6), { ...defaultSensorOpts, seed: 7 });
    const lines = calDiagnosisLines(diagnoseCalibration(s.gps, []));
    expect(lines[0]).toMatchObject({ label: '결과', bad: true });
    expect(lines[0]!.text).toMatch(/동작 센서 값이 없어요/);
  });
});
