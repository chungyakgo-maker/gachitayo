// G미터 최대 G 점 (2026-11-20 세영 "최대게이지만큼 선으로 이어봐" → 시안 docs/mock/2026-11-20-gpeaks.jpg):
// 방향 72칸(5°)마다 이번 주행에서 가장 센 G(0.3초 평균)를 기억하고, 각도 순서대로 내준다
import { describe, expect, it } from 'vitest';
import { GPeaks, lapGPeaks } from '../../src/engine/derive/gPeaks';

/** t0부터 20 ms마다 같은 G를 ms 동안 넣는다 */
function hold(p: GPeaks, t0: number, ms: number, gx: number | null, gy: number | null): number {
  let t = t0;
  for (; t <= t0 + ms; t += 20) p.push(t, gx, gy);
  return t;
}

describe('방향마다 가장 센 G', () => {
  it('같은 방향은 더 센 값만 남는다 (제동 0.8 g 뒤 0.5 g)', () => {
    const p = new GPeaks();
    let t = hold(p, 0, 1000, -0.8, 0);
    t = hold(p, t, 1000, 0, 0);
    hold(p, t, 1000, -0.5, 0);
    const pts = p.points();
    expect(pts.length).toBe(1);
    expect(pts[0]![0]).toBeCloseTo(-0.8, 6);
    expect(pts[0]![1]).toBeCloseTo(0, 6);
  });

  it('다른 방향은 각각 남고, 원을 도는 순서대로 나온다 (제동·왼쪽·가속·오른쪽을 섞어 넣어도)', () => {
    const p = new GPeaks();
    let t = 0;
    for (const [gx, gy] of [
      [0.4, 0], // 가속
      [-0.9, 0], // 제동
      [0, -0.7], // 오른쪽
      [0, 0.6], // 왼쪽
    ] as const) {
      t = hold(p, t, 800, gx, gy);
      t = hold(p, t, 400, null, null); // 사이를 끊어 평균이 섞이지 않게
    }
    const pts = p.points();
    expect(pts.length).toBe(4);
    // 화면 각도(왼쪽 G = 왼쪽, 제동 = 위)로 한 방향으로 돈다: 각도가 커지는 순서
    const ang = pts.map(([gx, gy]) => Math.atan2(gx, -gy));
    const norm = ang.map((a) => (a + 2 * Math.PI) % (2 * Math.PI));
    expect([...norm].sort((a, b) => a - b)).toEqual(norm);
  });

  it('칸은 5°: 3° 차이 두 값은 한 칸(센 것만), 10° 차이는 두 칸', () => {
    // 화면 각도 φ (오른쪽 0°, 아래 90°: 화면 x = −좌우, y = 앞뒤) → [앞뒤, 좌우] g
    const at = (deg: number, g: number) => [g * Math.sin((deg * Math.PI) / 180), -g * Math.cos((deg * Math.PI) / 180)] as const;
    const one = new GPeaks();
    let t = hold(one, 0, 600, ...at(101, 0.5));
    t = hold(one, t, 400, null, null);
    hold(one, t, 600, ...at(104, 0.7));
    expect(one.points().length).toBe(1);
    expect(Math.hypot(...one.points()[0]!)).toBeCloseTo(0.7, 6);
    const two = new GPeaks();
    t = hold(two, 0, 600, ...at(101, 0.5));
    t = hold(two, t, 400, null, null);
    hold(two, t, 600, ...at(111, 0.7));
    expect(two.points().length).toBe(2);
  });
});

describe('튀는 값 거르기 (0.3초 평균)', () => {
  it('한순간(20 ms) 2 g 튐은 평균에 묻혀 작게만 남는다', () => {
    const p = new GPeaks();
    let t = hold(p, 0, 600, 0.1, 0);
    p.push(t, 2, 0);
    t += 20;
    hold(p, t, 600, 0.1, 0);
    const peak = Math.max(...p.points().map(([gx, gy]) => Math.hypot(gx, gy)));
    expect(peak).toBeLessThan(0.3);
  });

  it('끊긴 뒤 0.3초가 안 된 값은 아직 넣지 않는다 (평균할 만큼 모이지 않음)', () => {
    const p = new GPeaks();
    hold(p, 0, 200, -1, 0);
    expect(p.points()).toEqual([]);
  });

  it('0.3초 넘게 이어진 값은 그대로 잡힌다', () => {
    const p = new GPeaks();
    hold(p, 0, 500, -1.1, 0);
    expect(Math.hypot(...p.points()[0]!)).toBeCloseTo(1.1, 6);
  });

  it('값이 없으면(보정 전 임시 G 등) 평균을 끊는다: 앞뒤 값이 섞이지 않는다', () => {
    const p = new GPeaks();
    let t = hold(p, 0, 400, -1, 0);
    p.push(t, null, null);
    t += 20;
    hold(p, t, 400, 0, 0.05); // 끊긴 뒤 값은 앞의 제동과 섞이지 않는다
    const pts = p.points();
    // 제동 칸 하나 + 약한 왼쪽 칸 하나 (섞였다면 제동과 왼쪽 사이 방향에 큰 값이 생긴다)
    expect(pts.length).toBe(2);
    const left = pts.find(([gx]) => Math.abs(gx) < 0.01)!;
    expect(left[1]).toBeCloseTo(0.05, 6);
  });
});

describe('그 밖', () => {
  it('아주 약한 G(0.02 g 미만)는 방향이 의미 없어 넣지 않는다', () => {
    const p = new GPeaks();
    hold(p, 0, 1000, 0.01, -0.01);
    expect(p.points()).toEqual([]);
  });

  it('바뀌지 않으면 같은 배열을 그대로 준다 (재생 타임라인이 프레임마다 복사하지 않게), 바뀌면 새 배열', () => {
    const p = new GPeaks();
    let t = hold(p, 0, 600, -0.6, 0);
    const a = p.points();
    t = hold(p, t, 600, -0.3, 0);
    expect(p.points()).toBe(a);
    hold(p, t, 600, -0.9, 0);
    expect(p.points()).not.toBe(a);
    expect(a[0]![0]).toBeCloseTo(-0.6, 6); // 예전 배열은 그대로 (재생에서 앞 시각 프레임이 바뀌지 않게)
  });

  it('시각이 거꾸로 가면 새로 시작', () => {
    const p = new GPeaks();
    hold(p, 5000, 600, -0.9, 0);
    p.push(100, 0, 0.4);
    expect(p.points()).toEqual([]);
  });
});

describe('저장된 기록의 한 랩에서 (분석 G 다이어그램, 2026-11-20 시안 docs/mock/2026-11-20-gpeaks-analysis.jpg)', () => {
  const MS2 = 9.80665;
  // 10 Hz, ax·ay 는 m/s² (처리된 궤적)
  const track = (rows: Array<[lap: number, ax: number | null, ay: number | null]>) => ({
    n: rows.length,
    t: rows.map((_, i) => i * 100),
    lapNo: rows.map((r) => r[0]),
    ax: rows.map((r) => r[1]),
    ay: rows.map((r) => r[2]),
  });

  it('그 랩의 G만, g 단위로 (m/s² ÷ 중력)', () => {
    const rows: Array<[number, number | null, number | null]> = [];
    for (let i = 0; i < 10; i++) rows.push([1, -0.8 * MS2, 0]); // 랩 1: 제동 0.8 g
    for (let i = 0; i < 10; i++) rows.push([2, 0, 0.6 * MS2]); // 랩 2: 왼쪽 0.6 g
    const p = track(rows);
    const one = lapGPeaks(p, 1);
    expect(one.length).toBe(1);
    expect(one[0]![0]).toBeCloseTo(-0.8, 6);
    const two = lapGPeaks(p, 2);
    expect(two.length).toBe(1);
    expect(two[0]![1]).toBeCloseTo(0.6, 6);
    expect(lapGPeaks(p, 3)).toEqual([]);
  });

  it('보정 전(G 없음, null)은 평균을 끊는다', () => {
    const rows: Array<[number, number | null, number | null]> = [];
    for (let i = 0; i < 5; i++) rows.push([1, -1 * MS2, 0]);
    rows.push([1, null, null]);
    for (let i = 0; i < 5; i++) rows.push([1, 0, 0.3 * MS2]);
    const pts = lapGPeaks(track(rows), 1);
    expect(pts.length).toBe(2);
    expect(Math.max(...pts.map(([gx, gy]) => Math.hypot(gx, gy)))).toBeCloseTo(1, 6);
  });
});
