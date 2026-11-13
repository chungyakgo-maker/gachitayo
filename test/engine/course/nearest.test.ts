import { describe, expect, it } from 'vitest';
import { stadiumTrack, windingWithHairpins } from '../../generators';
import { nearestCourse } from '../../../src/engine/course/nearest';
import { fromLocal } from '../../../src/engine/geo';
import { courseFromTrack, ORIGIN } from './helpers';
import { BUILTIN_COURSES, builtinCourse } from '../../../src/courses/builtin';
import { BUILTIN_POINTS } from '../../../src/courses/builtinData';
import { reverseCourse } from '../../../src/engine/course/edit';

describe('현재 위치에서 가까운 코스 (사양서 8.3)', () => {
  const oval = { ...courseFromTrack(stadiumTrack(), { id: 'oval' }) };
  const far = { ...courseFromTrack(windingWithHairpins(), { id: 'far' }), origin: { lat: 37.5, lon: 127.0 } };

  it('코스 근처(중심선에서 100 m)면 그 코스, 거리도 알려준다', () => {
    const p = fromLocal(ORIGIN, 0, -100);
    const r = nearestCourse([far, oval], p.lat, p.lon)!;
    expect(r.course.id).toBe('oval');
    expect(r.distanceM).toBeGreaterThan(50);
    expect(r.distanceM).toBeLessThan(150);
  });

  it('1 km 넘게 떨어져 있으면 없음', () => {
    const p = fromLocal(ORIGIN, 0, -3000);
    expect(nearestCourse([oval], p.lat, p.lon)).toBeNull();
  });

  it('중심선이 없는 코스(지도 등록)는 출발선까지 거리로 본다', () => {
    const noLine = { ...oval, id: 'map', centerline: null, lengthM: null, sectorBoundsM: null };
    const p = fromLocal(ORIGIN, 20, 0);
    expect(nearestCourse([noLine], p.lat, p.lon)!.course.id).toBe('map');
  });

  it('긴 편도 코스(배후령 8.5 km)도 출발선에서 먼 끝 근처면 찾고, 멀리(50 km)면 없음', () => {
    const b = BUILTIN_COURSES[0]!;
    const c = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: 'bh', gateWidthM: 30 });
    const end = c.centerline![c.centerline!.length - 1]!;
    const r = nearestCourse([c], end[0] + 0.002, end[1])!;
    expect(r.course.id).toBe('bh');
    expect(r.distanceM).toBeLessThan(250);
    expect(nearestCourse([c], end[0] + 0.45, end[1])).toBeNull();
  });

  it('같은 길의 정방향·역방향 코스 (사용자 신고 "출근 역방향으로 탔는데 인식 안 됨"): 출발선이 가까운 쪽, 목록 순서와 상관없이', () => {
    const b = BUILTIN_COURSES.find((x) => x.key === 'haogogae')!;
    const fwd = { ...builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: 'fwd', gateWidthM: 30 }), builtin: undefined, name: '출근' };
    const rev = reverseCourse(fwd, { id: 'rev', name: '출근 역방향' });
    for (const list of [[fwd, rev], [rev, fwd]]) {
      // 역방향 출발선(= 출근 도착선) 근처에 있으면 역방향
      expect(nearestCourse(list, rev.startGate.lat + 0.00005, rev.startGate.lon)!.course.id).toBe('rev');
      // 출근 출발선 근처에 있으면 출근
      expect(nearestCourse(list, fwd.startGate.lat + 0.00005, fwd.startGate.lon)!.course.id).toBe('fwd');
    }
  });
});
