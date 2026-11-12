import { describe, expect, it } from 'vitest';
import { stadiumTrack, windingWithHairpins } from '../../generators';
import { nearestCourse } from '../../../src/engine/course/nearest';
import { fromLocal } from '../../../src/engine/geo';
import { courseFromTrack, ORIGIN } from './helpers';

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
});
