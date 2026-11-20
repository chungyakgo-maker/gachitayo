import { describe, expect, it } from 'vitest';
import { GTrailBuffer, gPeakShape, gPeakStyle, gRings, gToUnit, gTrailCurves, smoothTrail, trailBeziers } from '../../../src/ui/overlay/gmeter';

describe('G미터 최대값과 궤적 (사용자 요청)', () => {
  it('눈금 원: 1.5 g는 0.5 g마다, 2·2.5·3 g는 1 g마다 + 최대값', () => {
    expect(gRings(1.5)).toEqual([0.5, 1, 1.5]);
    expect(gRings(2)).toEqual([1, 2]);
    expect(gRings(2.5)).toEqual([1, 2, 2.5]);
    expect(gRings(3)).toEqual([1, 2, 3]);
  });

  it('최대값으로 나누고, 원 밖은 둘레에 붙인다 (왼쪽 G는 왼쪽, 제동은 위)', () => {
    expect(gToUnit(0, 1, 2)).toEqual([-0.5, 0]);
    expect(gToUnit(-1, 0, 2)).toEqual([-0, -0.5]);
    const [x, y] = gToUnit(3, 4, 2);
    expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
  });

  it('최근 2초만 모으고, 시각이 거꾸로 가면 새로 시작', () => {
    const b = new GTrailBuffer();
    for (let t = 0; t <= 3000; t += 100) b.push(t, t / 3000, 0);
    expect(b.points().length).toBe(21);
    b.push(3000, 9, 9);
    expect(b.points().length).toBe(21);
    b.push(500, 0.1, 0.2);
    expect(b.points()).toEqual([[0.1, 0.2]]);
    b.push(600, null, 0.2);
    expect(b.points().length).toBe(1);
  });

  it('다듬기: 튀는 점은 누그러지고 양 끝은 그대로, 곡선은 모든 점을 지난다', () => {
    const pts = [[0, 0], [0.1, 0], [0.9, 0], [0.3, 0], [0.4, 0]] as const;
    const s = smoothTrail(pts);
    expect(s[0]).toEqual([0, 0]);
    expect(s[4]).toEqual([0.4, 0]);
    expect(s[2]![0]).toBeLessThan(0.9);
    const bz = trailBeziers(s);
    expect(bz.length).toBe(4);
    expect(bz[0]!.from).toEqual(s[0]);
    expect(bz[3]!.to).toEqual(s[4]);
    expect(gTrailCurves([[0, 0]], 2)).toEqual([]);
    expect(gTrailCurves([[0, 0], [1, 0], [2, 0]], 2).length).toBe(2);
  });
});

describe('최대 G 점 그리기 (2026-11-20 세영, 시안 docs/mock/2026-11-20-gpeaks.jpg)', () => {
  it('색·선: 0.25 g 아래 파랑 점선(가늘게) → 보라 → 0.8 g 넘으면 진한 빨강 실선(굵게)', () => {
    const weak = gPeakStyle(0.2);
    const mid = gPeakStyle(0.5);
    const firm = gPeakStyle(0.65);
    const strong = gPeakStyle(0.9);
    expect(weak.color).toBe('rgb(77, 163, 255)');
    expect(strong.color).toBe('rgb(255, 40, 40)');
    expect(gPeakStyle(3).color).toBe('rgb(255, 40, 40)');
    expect(mid.color).not.toBe(weak.color);
    expect(mid.color).not.toBe(strong.color);
    expect(weak.dash).not.toBeNull();
    expect(mid.dash).not.toBeNull();
    expect(firm.dash).toBeNull();
    expect(strong.dash).toBeNull();
    expect(weak.width).toBeLessThan(mid.width);
    expect(mid.width).toBeLessThan(strong.width);
  });

  it('모양: 점 3개 이상은 받은 순서(각도 순)대로 닫힌 직선, 2개는 선 하나, 1개는 점만. 바깥 원 밖은 둘레에', () => {
    const pts = [
      [0.3, 0],
      [0, 0.6],
      [-0.9, 0],
    ] as const;
    const s = gPeakShape(pts, 2);
    expect(s.dots.map((d) => d.at)).toEqual(pts.map(([gx, gy]) => gToUnit(gx, gy, 2)));
    expect(s.segs.length).toBe(3);
    expect(s.segs[0]!.from).toEqual(s.dots[0]!.at);
    expect(s.segs[2]!.to).toEqual(s.dots[0]!.at);
    // 선 색은 양 끝 G의 평균으로
    expect(s.segs[1]!.g).toBeCloseTo((0.6 + 0.9) / 2, 9);
    expect(s.dots[2]!.g).toBeCloseTo(0.9, 9);
    expect(gPeakShape(pts.slice(0, 2), 2).segs.length).toBe(1);
    const one = gPeakShape(pts.slice(0, 1), 2);
    expect(one.segs).toEqual([]);
    expect(one.dots.length).toBe(1);
    expect(gPeakShape(undefined, 2)).toEqual({ segs: [], dots: [] });
    const big = gPeakShape(
      [
        [3, 0],
        [0, 3],
        [-3, 0],
      ],
      2,
    );
    for (const d of big.dots) expect(Math.hypot(...d.at)).toBeCloseTo(1, 9);
  });
});
