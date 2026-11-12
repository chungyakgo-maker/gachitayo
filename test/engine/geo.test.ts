import { describe, expect, it } from 'vitest';
import { fromLocal, toLocal } from '../../src/engine/geo';

const origin = { lat: 37.2, lon: 127.1 };

describe('지역 좌표 (사양서 7.1)', () => {
  it('원점은 (0, 0), 동쪽이 +x, 북쪽이 +y', () => {
    expect(toLocal(origin, origin.lat, origin.lon)).toEqual({ x: 0, y: 0 });
    const east = toLocal(origin, origin.lat, origin.lon + 0.001);
    const north = toLocal(origin, origin.lat + 0.001, origin.lon);
    expect(east.x).toBeGreaterThan(0);
    expect(Math.abs(east.y)).toBeLessThan(1e-9);
    expect(north.y).toBeGreaterThan(0);
  });

  it('위경도 → 평면 → 위경도 왕복 오차가 1 mm 미만', () => {
    for (const [x, y] of [
      [1234.5, -987.6],
      [-3000, 2500],
      [10, 10],
    ]) {
      const ll = fromLocal(origin, x!, y!);
      const back = toLocal(origin, ll.lat, ll.lon);
      expect(Math.hypot(back.x - x!, back.y - y!)).toBeLessThan(0.001);
    }
  });

  it('수 km 거리는 대권 거리와 0.1% 안에서 같다', () => {
    const p = { lat: 37.215, lon: 127.125 };
    const local = toLocal(origin, p.lat, p.lon);
    const R = 6_371_008.8;
    const rad = Math.PI / 180;
    const dLat = (p.lat - origin.lat) * rad;
    const dLon = (p.lon - origin.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(origin.lat * rad) * Math.cos(p.lat * rad) * Math.sin(dLon / 2) ** 2;
    const great = 2 * R * Math.asin(Math.sqrt(h));
    expect(Math.abs(Math.hypot(local.x, local.y) - great) / great).toBeLessThan(0.001);
  });
});
