// 경로 안내 엔진 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.2)
import { describe, expect, it } from 'vitest';
import { fromLocal } from '../../src/engine/geo';
import { bearingOfPsi, RouteGuide } from '../../src/engine/route/routeGuide';

const O = { lat: 37.5, lon: 127 };

/** 북쪽 300 m → 반지름 40 m 오른쪽 90° → 동쪽 300 m. 카카오 경로처럼 점 간격이 고르지 않게 */
function routePoints(): Array<[number, number]> {
  const xy: Array<[number, number]> = [];
  for (let y = 0; y <= 300; y += 30) xy.push([0, y]);
  for (let a = 180 - 7.5; a >= 90; a -= 7.5) {
    const t = (a * Math.PI) / 180;
    xy.push([40 + 40 * Math.cos(t), 300 + 40 * Math.sin(t)]);
  }
  for (let x = 70; x <= 340; x += 45) xy.push([x, 340]);
  return xy.map(([x, y]) => {
    const p = fromLocal(O, x, y);
    return [p.lat, p.lon];
  });
}
const LEN = 600 + (Math.PI / 2) * 40;
const at = (t: number, x: number, y: number, gpsOk = true) => ({ t, x, y, v: 10, gpsOk });

describe('RouteGuide', () => {
  it('notes from route', () => {
    const g = new RouteGuide(routePoints(), O);
    expect(g.lengthM).toBeGreaterThan(LEN - 3);
    expect(g.lengthM).toBeLessThan(LEN + 3);
    expect(g.notes).toHaveLength(1);
    expect(g.notes[0]!.dir).toBe('right');
  });

  it('tracks s and remaining', () => {
    const g = new RouteGuide(routePoints(), O);
    const r = g.update(at(0, 0, 100));
    expect(r.onRoute).toBe(true);
    expect(r.s!).toBeCloseTo(100, 0);
    expect(r.remainingM!).toBeCloseTo(g.lengthM - 100, 0);
    expect(r.lateralM).toBeLessThan(1);
    expect(r.arrived).toBe(false);
  });

  it('reroute after 3 s off', () => {
    const g = new RouteGuide(routePoints(), O);
    g.update(at(0, 0, 50));
    expect(g.update(at(1000, 200, 100)).wantReroute).toBe(false);
    expect(g.update(at(2000, 200, 100)).wantReroute).toBe(false);
    const r = g.update(at(3900, 200, 100));
    expect(r.onRoute).toBe(false);
    expect(r.lateralM).toBeGreaterThan(150);
    expect(r.wantReroute).toBe(false);
    expect(g.update(at(4100, 200, 100)).wantReroute).toBe(true);
  });

  it('no reroute while gps weak', () => {
    const g = new RouteGuide(routePoints(), O);
    for (let t = 0; t <= 5000; t += 500) expect(g.update(at(t, 200, 100, false)).wantReroute).toBe(false);
  });

  it('back on route resets off timer', () => {
    const g = new RouteGuide(routePoints(), O);
    g.update(at(0, 200, 100));
    g.update(at(2000, 200, 100));
    g.update(at(2500, 0, 120));
    g.update(at(3000, 200, 100));
    expect(g.update(at(5000, 200, 100)).wantReroute).toBe(false);
  });

  it('a little off (under 50 m) never reroutes', () => {
    const g = new RouteGuide(routePoints(), O);
    g.update(at(0, 0, 100));
    for (let t = 500; t <= 6000; t += 500) expect(g.update(at(t, 40, 100)).wantReroute).toBe(false);
  });

  it('arrives near end', () => {
    const g = new RouteGuide(routePoints(), O);
    g.update(at(0, 300, 340));
    const r = g.update(at(500, 322, 340));
    expect(r.arrived).toBe(true);
    // 도착한 뒤에는 멀리 가도 도착 그대로, 다시 찾지 않는다
    for (let t = 1000; t <= 6000; t += 500) {
      const s = g.update(at(t, 900, 900));
      expect(s.arrived).toBe(true);
      expect(s.wantReroute).toBe(false);
    }
  });

  it('hairpin: passing near the end on the way up is not arrival', () => {
    // 북쪽 300 m 오르고 반지름 12.5 m 헤어핀, 남쪽으로 280 m 내려와 끝 (끝점이 오르는 길에서 25 m)
    const xy: Array<[number, number]> = [];
    for (let y = 0; y <= 300; y += 20) xy.push([0, y]);
    for (let a = 180 - 15; a >= 0; a -= 15) xy.push([12.5 + 12.5 * Math.cos((a * Math.PI) / 180), 300 + 12.5 * Math.sin((a * Math.PI) / 180)]);
    for (let y = 280; y >= 20; y -= 20) xy.push([25, y]);
    const pts = xy.map(([x, y]) => {
      const p = fromLocal(O, x, y);
      return [p.lat, p.lon] as [number, number];
    });
    const g = new RouteGuide(pts, O);
    expect(g.update(at(0, 0, 10)).arrived).toBe(false);
    expect(g.update(at(500, 0, 20)).arrived).toBe(false);
    for (let i = 1; i <= 30; i++) g.update(at(500 + i * 1000, 0, 20 + i * 9));
    expect(g.update(at(40_000, 25, 200)).arrived).toBe(false);
    expect(g.update(at(41_000, 25, 120)).arrived).toBe(false);
    expect(g.update(at(42_000, 25, 45)).arrived).toBe(true);
  });

  it('long route keeps the tracking line small and the raw line for drawing', () => {
    // 200 km 직선 (점 두 개)
    const end = fromLocal(O, 0, 200_000);
    const g = new RouteGuide(
      [
        [O.lat, O.lon],
        [end.lat, end.lon],
      ],
      O,
    );
    expect(g.line.x.length).toBeLessThanOrEqual(50_001);
    expect(g.raw.x.length).toBe(2);
    expect(g.lengthM).toBeCloseTo(200_000, -2);
  });

  it('bearingOfPsi', () => {
    expect(bearingOfPsi(Math.PI / 2)).toBe(0);
    expect(bearingOfPsi(0)).toBe(90);
    expect(bearingOfPsi(Math.PI)).toBe(270);
    expect(bearingOfPsi(-Math.PI / 2)).toBe(180);
  });
});
