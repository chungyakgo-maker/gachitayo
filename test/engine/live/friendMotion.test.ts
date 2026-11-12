import { describe, expect, it } from 'vitest';
import { FriendMarker, predictFriend } from '../../../src/engine/live/friendMotion';
import { makePolyline, nearestOnPolyline } from '../../../src/engine/course/polyline';
import type { TrailPoint } from '../../../src/engine/live/gap';

const T0 = 1_800_000_000_000;
/** 원 위를 v m/s로 (반지름 R, 반시계) */
const circle = (R: number, v: number) => (t: number) => {
  const a = (v / R) * t;
  return { x: R * Math.sin(a), y: R - R * Math.cos(a) };
};

describe('앞 친구 위치 예측 (사용자 요청: 일정 속도로 가면 도로를 따라 부드럽게)', () => {
  it('직선 20 m/s: 마지막 위치보다 1.5초 뒤의 지금 위치를 1 m 안으로', () => {
    const pts: TrailPoint[] = [0, 1, 2, 3].map((s) => ({ t: T0 + s * 1000, x: 20 * s, y: 0, v: 20 }));
    const p = predictFriend(pts, T0 + 4500, null)!;
    expect(p.x).toBeCloseTo(90, 0);
    expect(Math.abs(p.y)).toBeLessThan(1);
  });

  it('코너(반지름 60 m, 20 m/s): 회전율로 휘어서 1.5초 뒤를 3 m 안으로 (마지막 위치를 그대로 쓰면 30 m 틀림)', () => {
    const at = circle(60, 20);
    const pts: TrailPoint[] = [0, 1, 2, 3].map((s) => ({ t: T0 + s * 1000, ...at(s), v: 20 }));
    const p = predictFriend(pts, T0 + 4500, null)!;
    const truth = at(4.5);
    expect(Math.hypot(p.x - truth.x, p.y - truth.y)).toBeLessThan(3);
    expect(Math.hypot(pts[3]!.x - truth.x, pts[3]!.y - truth.y)).toBeGreaterThan(25);
  });

  it('코스 선이 있으면 그 선을 따라 나아간다 (도로 위에서 벗어나지 않음)', () => {
    const at = circle(60, 20);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let t = 0; t <= 18; t += 0.1) {
      const p = at(t);
      xs.push(p.x);
      ys.push(p.y);
    }
    const line = makePolyline(xs, ys);
    const pts: TrailPoint[] = [0, 1, 2].map((s) => ({ t: T0 + s * 1000, x: at(s).x + 2, y: at(s).y - 1, v: 20 }));
    for (const dt of [0.5, 1, 2, 2.9]) {
      const p = predictFriend(pts, T0 + 2000 + dt * 1000, { line, loop: false })!;
      expect(nearestOnPolyline(line, p.x, p.y).d).toBeLessThan(0.5);
      const truth = at(2 + dt);
      expect(Math.hypot(p.x - truth.x, p.y - truth.y)).toBeLessThan(4);
    }
  });

  it('맨 끝 점이 튄 점이면 그 앞 점들로 예측한다', () => {
    const pts: TrailPoint[] = [0, 1, 2, 3].map((s) => ({ t: T0 + s * 1000, x: 20 * s, y: 0, v: 20 }));
    pts.push({ t: T0 + 4000, x: 80, y: 70, v: 20 });
    const p = predictFriend(pts, T0 + 4000, null)!;
    expect(Math.abs(p.y)).toBeLessThan(1);
    expect(p.x).toBeCloseTo(80, 0);
  });

  it('새 위치가 와서 예측이 바뀌어도 아이콘은 튀지 않고 0.6초에 걸쳐 따라간다', () => {
    const m = new FriendMarker();
    // 20 m/s로 오다가 3초부터 15 m/s로 느려짐 (늦게 알게 된다)
    const truthX = (t: number) => (t <= 3 ? 20 * t : 60 + 15 * (t - 3));
    for (let s = 0; s <= 3; s++) m.push({ t: T0 + s * 1000, x: truthX(s), y: 0, v: s < 3 ? 20 : 15 });
    let prev = m.position(T0 + 3800, null)!.x;
    let maxStep = 0;
    for (let t = 3.9; t <= 6; t += 0.1) {
      if (Math.abs(t - 4.8) < 0.05) m.push({ t: T0 + 4000, x: truthX(4), y: 0, v: 15 }); // 4초 위치가 0.8초 늦게 도착
      const x = m.position(T0 + t * 1000, null)!.x;
      maxStep = Math.max(maxStep, Math.abs(x - prev));
      prev = x;
    }
    // 0.1초에 20 m/s면 2 m. 새 위치가 와도 한 번에 크게 뛰지 않는다
    expect(maxStep).toBeLessThan(3);
    // 결국 실제 위치로 (6초: 105 m)
    expect(prev).toBeCloseTo(truthX(6), 0);
  });
});
