import { describe, expect, it } from 'vitest';
import { buildTrace, refTimeAt } from '../../src/engine/delta/trace';
import { DeltaFilter, rawDelta } from '../../src/engine/delta/delta';

/** 1000 m를 초속 20 m로 달리는 랩 (factor > 1이면 그만큼 느림) */
function lapFrames(factor = 1, startT = 10_000) {
  const t: number[] = [];
  const s: number[] = [];
  const v: number[] = [];
  for (let k = 0; k <= 50 * 50 * factor; k++) {
    const tt = (k * 20) / 1000; // 초
    t.push(startT + k * 20);
    s.push(Math.min(1000, (20 / factor) * tt));
    v.push(20 / factor);
  }
  return { t, s, v, alt: s.map((x) => 100 + x / 100), startT, lengthM: 1000 };
}

describe('비교용 축약 데이터 trace (사양서 6.8)', () => {
  it('5 m 격자, 첫 값 0, 시간은 랩 시작부터 초(소수 3자리), 속도·고도', () => {
    const tr = buildTrace(lapFrames());
    expect(tr.stepM).toBe(5);
    expect(tr.t).toHaveLength(201);
    expect(tr.t[0]).toBe(0);
    expect(tr.t[1]).toBeCloseTo(0.25, 9);
    expect(tr.t[200]).toBeCloseTo(50, 9);
    for (let i = 1; i < tr.t.length; i++) expect(tr.t[i]!).toBeGreaterThan(tr.t[i - 1]!);
    expect(tr.v[100]).toBeCloseTo(20, 6);
    expect(tr.alt[100]).toBeCloseTo(105, 6);
    for (const x of tr.t) expect(Math.round(x * 1000) / 1000).toBe(x);
  });

  it('격자 사이·마지막 격자 뒤는 보간한다', () => {
    const tr = buildTrace(lapFrames());
    expect(refTimeAt(tr, 7.5, 50_000)).toBeCloseTo(0.375, 9);
    const short = { ...tr, t: tr.t.slice(0, 200), v: tr.v.slice(0, 200), alt: tr.alt.slice(0, 200) }; // 마지막 격자(1000 m)가 없다고 치면
    expect(refTimeAt(short, 1000, 50_000)).toBeCloseTo(50, 6);
  });
});

describe('델타 (사양서 7.11)', () => {
  const ref = buildTrace(lapFrames());

  it('같은 랩끼리는 0', () => {
    for (const s of [0, 123, 500, 999]) expect(rawDelta((s / 20) * 1000, s, ref, 50_000)).toBeCloseTo(0, 6);
  });

  it('3% 느린 랩은 끝에서 랩타임 차만큼 + (느림)', () => {
    const slow = lapFrames(1.03);
    const lastIdx = slow.s.findIndex((x) => x >= 999);
    const d = rawDelta(slow.t[lastIdx]! - slow.startT, slow.s[lastIdx]!, ref, 50_000);
    expect(d).toBeGreaterThan(0);
    expect(Math.abs(d - 1.5)).toBeLessThan(0.05);
  });

  it('지수 평활: 시간 상수 0.3초 (10 Hz로 넣으면 0.3초 뒤 1−e⁻¹)', () => {
    const f = new DeltaFilter();
    f.push(0, 0);
    let v = 0;
    for (let t = 100; t <= 300; t += 100) v = f.push(t, 1)!;
    expect(v).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it('숨김(null)이면 null을 돌려주고, 다시 나타나면 처음 값부터 시작한다', () => {
    const f = new DeltaFilter();
    f.push(0, 2);
    expect(f.push(100, null)).toBeNull();
    expect(f.push(200, -1)).toBe(-1);
  });
});

describe('고스트: 비교 랩이 같은 경과 시간에 있던 코스 거리', () => {
  it('t_ref(s)의 역함수 (등속 20 m/s, 1000 m)', async () => {
    const { refDistanceAt } = await import('../../src/engine/delta/trace');
    const stepM = 5;
    const L = 1000;
    const trace = { stepM, t: Array.from({ length: L / stepM + 1 }, (_, i) => (i * stepM) / 20), v: [], alt: [] };
    expect(refDistanceAt(trace, 10, 50_000, L)).toBeCloseTo(200, 6);
    expect(refDistanceAt(trace, 12.345, 50_000, L)).toBeCloseTo(246.9, 6);
    expect(refDistanceAt(trace, 0, 50_000, L)).toBe(0);
    expect(refDistanceAt(trace, -1, 50_000, L)).toBe(0);
    expect(refDistanceAt(trace, 60, 50_000, L)).toBe(L);
  });
});
