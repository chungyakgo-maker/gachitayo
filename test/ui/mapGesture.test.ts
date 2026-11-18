// 주행 지도 두 손가락 (사용자 요청 2026-11-17 "부드럽게 확대·축소", "손으로 지도 회전"):
// 벌리고 오므리는 만큼 연속으로 확대, 비틀면(10° 넘게부터) 지도를 돌린다
import { describe, expect, it } from 'vitest';
import { TwoFingerGesture, upBearing } from '../../src/ui/map/mapGesture';

/** 가운데 (200, 300) 에서 거리 d, 화면 각도 deg(시계 방향 +) 로 두 손가락 */
const fingers = (d: number, deg = 0) => {
  const a = (deg * Math.PI) / 180;
  const dx = (Math.cos(a) * d) / 2;
  const dy = (Math.sin(a) * d) / 2;
  return [{ x: 200 - dx, y: 300 - dy }, { x: 200 + dx, y: 300 + dy }] as const;
};

describe('두 손가락 확대·축소 (계단 없이)', () => {
  it('벌린 비율만큼 연속으로: 2배 = +1, √2배 = +0.5, 반 = −1', () => {
    const [a, b] = fingers(100);
    const g = new TwoFingerGesture(a, b, { zoom: 0, bearing: null });
    expect(g.move(...fingers(141.421356)).zoom).toBeCloseTo(0.5, 4);
    expect(g.move(...fingers(200)).zoom).toBeCloseTo(1, 4);
    expect(g.move(...fingers(50)).zoom).toBeCloseTo(-1, 4);
  });

  it('지금 확대에서 이어서, 범위(−4 ~ +2) 밖으로는 안 간다', () => {
    const g = new TwoFingerGesture(...fingers(100), { zoom: 1.5, bearing: null });
    expect(g.move(...fingers(400)).zoom).toBe(2);
    expect(new TwoFingerGesture(...fingers(100), { zoom: -3.5, bearing: null }).move(...fingers(10)).zoom).toBe(-4);
  });
});

describe('두 손가락 돌리기', () => {
  it('10° 안쪽으로 비틀린 것은 돌리지 않는다 (확대하다 조금 비틀려도)', () => {
    const g = new TwoFingerGesture(...fingers(100, 0), { zoom: 0, bearing: 40 });
    expect(g.move(...fingers(150, 8)).bearing).toBeNull();
  });

  it('넘으면 그 자리부터 튀지 않고 돈다. 손가락을 시계 방향으로 돌리면 지도도 시계 방향 (방위는 줄어든다)', () => {
    const g = new TwoFingerGesture(...fingers(100, 0), { zoom: 0, bearing: 40 });
    expect(g.move(...fingers(100, 12)).bearing).toBeCloseTo(40, 6);
    expect(g.move(...fingers(100, 42)).bearing).toBeCloseTo(10, 6);
    expect(g.move(...fingers(100, 72)).bearing).toBeCloseTo(340, 6);
    expect(g.rotated).toBe(true);
  });

  it('돌릴 수 없는 보기(전체 코스)에서는 확대만', () => {
    const g = new TwoFingerGesture(...fingers(100, 0), { zoom: 0, bearing: null });
    const r = g.move(...fingers(200, 60));
    expect(r.bearing).toBeNull();
    expect(r.zoom).toBeCloseTo(1, 4);
    expect(g.rotated).toBe(false);
  });
});

describe('지도 위쪽 방위', () => {
  it('전체 코스는 늘 북쪽 위, 손으로 돌렸으면 그 방위, 아니면 진행 방향 위 보기만 진행 방향', () => {
    expect(upBearing('fit', 30, Math.PI / 2)).toBeNull();
    expect(upBearing('follow', 30, Math.PI / 2)).toBe(30);
    expect(upBearing('heading', 30, Math.PI / 2)).toBe(30);
    expect(upBearing('heading', null, 0)).toBeCloseTo(90, 6); // 동쪽으로 가면 위가 동쪽
    expect(upBearing('heading', null, null)).toBeNull();
    expect(upBearing('follow', null, 0)).toBeNull();
  });
});
