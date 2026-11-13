import { describe, expect, it } from 'vitest';
import { stadiumTrack } from '../../generators';
import { buildGeometry } from '../../../src/engine/course/geometry';
import { LiveEngine } from '../../../src/engine/live/liveEngine';
import { courseFromTrack } from '../course/helpers';

describe('주행 중 엔진: 구간 델타와 최고 속도 (대시보드)', () => {
  it('비교 랩보다 5% 느리게 달리면 끝난 구간 델타 = 구간 기록 − 비교 구간, 지금 구간은 구간 시작 뒤 늘어난 델타', () => {
    const oval = stadiumTrack();
    const course = courseFromTrack(oval, { gateAtS: 100 });
    const geom = buildGeometry(course);
    const L = course.lengthM!;
    const vRef = 20;
    const trace = { stepM: 5, t: Array.from({ length: Math.floor(L / 5) + 1 }, (_, i) => (i * 5) / vRef), v: [], alt: [] };
    const sectorRef: [number, number, number] = [((L / 3) / vRef) * 1000, ((L / 3) / vRef) * 1000, ((L / 3) / vRef) * 1000];
    const live = new LiveEngine(geom, { trace, lapTimeMs: (L / vRef) * 1000, sectorTimesMs: sectorRef });
    const v = 19;
    let st = null as ReturnType<LiveEngine['push']> | null;
    let midSector2: ReturnType<LiveEngine['push']> | null = null;
    for (let t = 0; t <= ((L + 150) / v) * 1000; t += 100) {
      const p = oval.pointAt((t / 1000) * v % oval.length);
      st = live.push({ t, x: p.x, y: p.y, v, sigmaPos: 2, ax: null, ay: null, gpsOk: true, gCalibrated: false });
      // 출발선(100 m) 통과 뒤 구간 2 가운데쯤
      if (!midSector2 && (t / 1000) * v > 100 + L / 2) midSector2 = st;
    }
    const expected1 = (L / 3) / v - (L / 3) / vRef;
    expect(midSector2!.currentSector).toBe(1);
    expect(midSector2!.sectorDeltas[0]!).toBeCloseTo(expected1, 1);
    // 구간 2를 절반쯤 달렸으니 그 구간에서 늘어난 델타는 구간 1 델타의 절반 정도
    expect(midSector2!.sectorDeltas[1]!).toBeGreaterThan(expected1 * 0.3);
    expect(midSector2!.sectorDeltas[1]!).toBeLessThan(expected1 * 0.7);
    expect(midSector2!.sectorDeltas[2]).toBeNull();
    expect(st!.maxSpeedKmh).toBeCloseTo(v * 3.6, 6);
  });

  it('비교 랩이 없으면 구간 델타는 없다', () => {
    const geom = buildGeometry(courseFromTrack(stadiumTrack(), { gateAtS: 100 }));
    const st = new LiveEngine(geom, null).push({ t: 0, x: 0, y: 0, v: 10, sigmaPos: 2, ax: null, ay: null, gpsOk: true, gCalibrated: false });
    expect(st.sectorDeltas).toEqual([null, null, null]);
  });
});

// 코스 이탈 안내 B (설계 docs/superpowers/specs/2026-11-13-off-course-design.md): 랩 안에서 코스와 30 m 넘게 떨어지면 거리(10 m 단위)
describe('주행 중 코스 이탈 거리', () => {
  it('출발선 전에는 코스 밖이어도 이탈 거리를 주지 않고, 랩 안에서 벗어나면 코스까지 거리를 준다', () => {
    const oval = stadiumTrack();
    const course = courseFromTrack(oval, { gateAtS: 100 });
    const live = new LiveEngine(buildGeometry(course), null);
    const v = 15;
    const push = (t: number, x: number, y: number) => live.push({ t, x, y, v, sigmaPos: 2, ax: null, ay: null, gpsOk: true, gCalibrated: false });
    // 출발선 전, 코스에서 80 m 떨어진 곳
    const p0 = oval.pointAt(50);
    expect(push(0, p0.x, p0.y + 80).offCourseM).toBeNull();
    // 코스를 따라 출발선을 지나 랩 안으로
    let t = 1000;
    let st = push(t, p0.x, p0.y);
    for (let s = 50; s <= 300; s += 5) {
      t += (5 / v) * 1000;
      const p = oval.pointAt(s);
      st = push(t, p.x, p.y);
    }
    expect(st.lapElapsedMs).not.toBeNull();
    expect(st.offCourseM).toBeNull();
    // 코스 옆 47 m로 벗어남 → 50 m (10 m 단위)
    const p1 = oval.pointAt(305);
    const n = { x: -(oval.pointAt(306).y - p1.y), y: oval.pointAt(306).x - p1.x };
    const len = Math.hypot(n.x, n.y);
    st = push(t + 400, p1.x + (n.x / len) * 47, p1.y + (n.y / len) * 47);
    expect(st.onCourse).toBe(false);
    expect(st.offCourseM).toBe(50);
  });
});
