// 받은 코스·백업·팀 코스를 "있는 코스"로 잇는 판단 (검토 지적: 출발선만 보면 같은 주차장에서 시작하는 다른 길이 같은 코스가 됐다)
import { describe, expect, it } from 'vitest';
import { sameCourseShape } from '../../src/engine/course/edit';
import type { Course } from '../../src/types/course';

const gate = (lat: number, lon: number) => ({ lat, lon, bearingDeg: 0, widthM: 30 });
const loop = (radiusDeg: number, p: Partial<Course> = {}): Course => {
  const pts = Array.from({ length: 200 }, (_, i) => {
    const a = (i / 199) * Math.PI * 2;
    return [37.5 + radiusDeg * (1 - Math.cos(a)), 127 + radiusDeg * Math.sin(a) * 1.25] as [number, number];
  });
  return { id: 'x', name: 'x', kind: 'loop', source: 'auto', origin: { lat: 37.5, lon: 127 }, startGate: gate(37.5, 127), finishGate: gate(37.5, 127), centerline: pts, lengthM: radiusDeg * 111_000 * 2 * Math.PI, sectorBoundsM: null, version: 1, ...p };
};

describe('sameCourseShape', () => {
  it('같은 출발선에서 시작해도 길이·선이 다르면 다른 코스', () => {
    expect(sameCourseShape(loop(0.005), loop(0.02))).toBe(false);
  });
  it('같은 선(점 간격만 다름)은 같은 코스', () => {
    const a = loop(0.01);
    const b = { ...a, centerline: a.centerline!.filter((_, i) => i % 3 === 0) };
    expect(sameCourseShape(a, b)).toBe(true);
  });
  it('선이 없으면 출발·도착선과 길이로만 본다', () => {
    expect(sameCourseShape(loop(0.01, { centerline: null }), loop(0.01))).toBe(true);
    expect(sameCourseShape(loop(0.01, { centerline: null, lengthM: 1000 }), loop(0.01))).toBe(false);
  });
});
