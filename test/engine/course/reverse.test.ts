import { describe, expect, it } from 'vitest';
import { stadiumTrack } from '../../generators';
import { buildGeometry } from '../../../src/engine/course/geometry';
import { reverseCourse, reverseName, sameCourse } from '../../../src/engine/course/edit';
import { splitLaps, type FrameTrack } from '../../../src/engine/course/laps';
import { makePolyline, polylinePoint } from '../../../src/engine/course/polyline';
import { BUILTIN_COURSES, builtinCourse } from '../../../src/courses/builtin';
import { BUILTIN_POINTS } from '../../../src/courses/builtinData';
import type { Course } from '../../../src/types/course';
import { courseFromTrack } from './helpers';

const V = 15;

/** 경로를 따라 15 m/s, 10 Hz로 달린 궤적. 앞뒤로 40 m씩 더 달린다 (출발선·도착선을 확실히 지나게) */
function drive(xs: number[], ys: number[], laps = 1): FrameTrack {
  const px: number[] = [];
  const py: number[] = [];
  const lead = (i: number, j: number) => {
    const dx = xs[i]! - xs[j]!;
    const dy = ys[i]! - ys[j]!;
    const d = Math.hypot(dx, dy) || 1;
    return { x: xs[i]! + (dx / d) * 40, y: ys[i]! + (dy / d) * 40 };
  };
  const pre = lead(0, 1);
  px.push(pre.x);
  py.push(pre.y);
  for (let l = 0; l < laps; l++) for (let i = 0; i < xs.length; i++) (px.push(xs[i]!), py.push(ys[i]!));
  const post = laps > 1 ? { x: xs[1]!, y: ys[1]! } : lead(xs.length - 1, xs.length - 2);
  px.push(post.x);
  py.push(post.y);
  const p = makePolyline(px, py);
  const n = Math.floor(p.length / (V * 0.1));
  const fr: FrameTrack = { n, t: new Float64Array(n), x: new Float64Array(n), y: new Float64Array(n), v: new Float64Array(n).fill(V) };
  for (let k = 0; k < n; k++) {
    const q = polylinePoint(p, k * V * 0.1);
    fr.t[k] = k * 100;
    fr.x[k] = q.x;
    fr.y[k] = q.y;
  }
  return fr;
}

const lapsOn = (c: Course, fr: FrameTrack) => {
  const gpsTimes = Array.from({ length: Math.ceil(fr.t[fr.n - 1]! / 1000) + 1 }, (_, i) => i * 1000);
  return splitLaps({ geom: buildGeometry(c), track: fr, gpsTimes, pauses: [] }).laps;
};

describe('역방향 코스 (사용자 요청)', () => {
  const b = BUILTIN_COURSES.find((x) => x.key === 'manhangjae')!;
  const mh = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: 'mh', gateWidthM: 30 });

  it('편도: 출발·도착을 맞바꾸고 방향을 뒤집는다. 길이는 같고 기본 코스 표시는 없다', () => {
    const r = reverseCourse(mh, { id: 'r', name: reverseName(mh.name) });
    expect(r).toMatchObject({ id: 'r', name: '만항재 역방향', kind: 'point_to_point', version: 1 });
    expect(r.builtin).toBeUndefined();
    expect([r.startGate.lat, r.startGate.lon]).toEqual([mh.finishGate.lat, mh.finishGate.lon]);
    expect(r.startGate.bearingDeg).toBeCloseTo((mh.finishGate.bearingDeg + 180) % 360, 6);
    expect(r.finishGate.bearingDeg).toBeCloseTo((mh.startGate.bearingDeg + 180) % 360, 6);
    expect(Math.abs(r.lengthM! - mh.lengthM!)).toBeLessThan(2);
    expect(r.centerline![0]).toEqual(mh.centerline![mh.centerline!.length - 1]);
  });

  it('반대로 달린 주행은 역방향 코스에서 랩 1개(시간 = 길이 / 속도), 원래 코스에서는 랩 없음', () => {
    const r = reverseCourse(mh, { id: 'r', name: '만항재 역방향' });
    const cl = buildGeometry(r).centerline!;
    const fr = drive(Array.from(cl.x), Array.from(cl.y));
    const laps = lapsOn(r, fr);
    expect(laps).toHaveLength(1);
    expect(laps[0]!.valid).toBe(true);
    expect(Math.abs(laps[0]!.lapTimeMs / 1000 - r.lengthM! / V)).toBeLessThan(2);
    expect(lapsOn(mh, fr)).toHaveLength(0);
  });

  it('랩 코스: 출발선 자리는 그대로, 방향만 반대. 반대로 2바퀴 달리면 역방향 코스에서 랩이 잡힌다', () => {
    const oval = courseFromTrack(stadiumTrack(), { id: 'oval' });
    const r = reverseCourse(oval, { id: 'ro', name: reverseName(oval.name) });
    expect([r.startGate.lat, r.startGate.lon]).toEqual([oval.startGate.lat, oval.startGate.lon]);
    expect(r.finishGate).toEqual(r.startGate);
    expect(Math.abs(r.lengthM! - oval.lengthM!)).toBeLessThan(2);
    const cl = buildGeometry(r).centerline!;
    const fr = drive(Array.from(cl.x), Array.from(cl.y), 2);
    expect(lapsOn(r, fr).filter((l) => l.valid).length).toBeGreaterThanOrEqual(1);
    expect(lapsOn(oval, fr)).toHaveLength(0);
  });

  it('이름: "만항재" ↔ "만항재 역방향", 두 번 뒤집으면 원래와 같은 코스', () => {
    expect(reverseName('만항재')).toBe('만항재 역방향');
    expect(reverseName('만항재 역방향')).toBe('만항재');
    expect(reverseName('가'.repeat(40))).toHaveLength(40);
    const r = reverseCourse(mh, { id: 'r', name: '만항재 역방향' });
    const rr = reverseCourse(r, { id: 'rr', name: '만항재' });
    expect(sameCourse(rr, mh)).toBe(true);
    expect(sameCourse(r, mh)).toBe(false);
  });

  it('중심선이 없는 코스(지도로 만들고 첫 주행 전)도 출발선·도착선만 맞바꾼다', () => {
    const bare = { ...mh, centerline: null, lengthM: null, sectorBoundsM: null };
    const r = reverseCourse(bare, { id: 'r', name: 'x' });
    expect(r.centerline).toBeNull();
    expect([r.finishGate.lat, r.finishGate.lon]).toEqual([mh.startGate.lat, mh.startGate.lon]);
  });
});
