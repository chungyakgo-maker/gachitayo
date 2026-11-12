import { describe, expect, it } from 'vitest';
import { makePolyline, polylinePoint, resamplePolyline, smoothPath } from '../../../src/engine/course/polyline';
import { buildGeometry, gateFromPoint } from '../../../src/engine/course/geometry';
import { stadiumTrack } from '../../generators';
import { courseFromTrack, ORIGIN } from './helpers';

describe('중심선 (사양서 7.5)', () => {
  it('1 m 간격으로 다시 샘플링한다 (양 끝 유지)', () => {
    const p = makePolyline([0, 17.5], [0, 0]);
    const r = resamplePolyline(p, 1);
    expect(r.length).toBeCloseTo(17.5, 9);
    for (let i = 1; i < r.s.length; i++) expect(r.s[i]! - r.s[i - 1]!).toBeCloseTo(17.5 / (r.s.length - 1), 9);
    expect(Math.abs(17.5 / (r.s.length - 1) - 1)).toBeLessThan(0.05);
  });

  it('곡선 코스를 1 m로 다시 샘플링해도 길이는 0.01% 안에서 같다', () => {
    const t = stadiumTrack();
    const xs: number[] = [];
    const ys: number[] = [];
    const n = Math.round(t.length / 0.25);
    for (let i = 0; i <= n; i++) {
      const q = t.pointAt((i / n) * t.length);
      xs.push(q.x);
      ys.push(q.y);
    }
    const r = resamplePolyline(makePolyline(xs, ys), 1);
    expect(Math.abs(r.length - t.length) / t.length).toBeLessThan(1e-4);
  });

  it('평활해도 길이가 0.5% 넘게 줄지 않는다 (오벌)', () => {
    const t = stadiumTrack();
    const xs: number[] = [];
    const ys: number[] = [];
    for (let s = 0; s <= t.length; s += 1) {
      const p = t.pointAt(s);
      xs.push(p.x);
      ys.push(p.y);
    }
    const sm = smoothPath(xs, ys, 6, true);
    const len = makePolyline(sm.x, sm.y).length;
    expect(Math.abs(len - t.length) / t.length).toBeLessThan(0.005);
  });

  it('지점과 진행 방향을 보간한다', () => {
    const p = makePolyline([0, 10, 10], [0, 0, 10]);
    expect(polylinePoint(p, 5)).toMatchObject({ x: 5, y: 0 });
    expect(polylinePoint(p, 15).psi).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('게이트', () => {
  it('진행 방향(나침반)과 폭으로 게이트 선분을 만든다', () => {
    const gate = gateFromPoint(100, 50, 0, ORIGIN, 30); // ψ=0: 동쪽으로 진행
    expect(gate.bearingDeg).toBeCloseTo(90, 6);
    const g = buildGeometry({ ...courseFromTrack(stadiumTrack()), startGate: gate, finishGate: gate }).start;
    expect(g.cx).toBeCloseTo(100, 3);
    expect(g.cy).toBeCloseTo(50, 3);
    expect(g.dx).toBeCloseTo(1, 6);
    expect(Math.hypot(g.bx - g.ax, g.by - g.ay)).toBeCloseTo(30, 6);
    // 게이트 선분은 진행 방향에 수직
    expect((g.bx - g.ax) * g.dx + (g.by - g.ay) * g.dy).toBeCloseTo(0, 6);
  });

  it('코스 기하: 중심선 길이와 구간 경계', () => {
    const t = stadiumTrack();
    const geom = buildGeometry(courseFromTrack(t));
    expect(geom.centerline!.length).toBeCloseTo(t.length, 0);
    expect(geom.sectorBounds![0]).toBeCloseTo(geom.centerline!.length / 3, 9);
    expect(geom.sectorBounds![1]).toBeCloseTo((2 * geom.centerline!.length) / 3, 9);
  });
});
