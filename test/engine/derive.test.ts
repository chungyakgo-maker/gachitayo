import { describe, expect, it } from 'vitest';
import { GForceSmoother, smoothG } from '../../src/engine/derive/gforce';
import { smoothAltitude } from '../../src/engine/derive/altitude';
import { gaussian, mulberry32 } from '../generators';
import type { GpsSample } from '../../src/types/samples';

describe('G값 (사양서 7.12)', () => {
  it('0.2초 이동평균을 g 단위로 (주행 후: 가운데 기준)', () => {
    const ax = new Float64Array(100).fill(9.80665);
    const ay = Float64Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : -1)); // 빠르게 흔들림
    const g = smoothG(ax, ay, 50);
    expect(g.gx[50]).toBeCloseTo(1, 9);
    expect(Math.abs(g.gy[50]!)).toBeLessThan(0.02);
  });

  it('주행 중: 지난 0.2초 평균', () => {
    const sm = new GForceSmoother();
    let r = { gx: 0, gy: 0 };
    for (let t = 0; t <= 1000; t += 20) r = sm.push(t, t >= 900 ? 9.80665 : 0, 0);
    expect(r.gx).toBeCloseTo(1 * (6 / 11), 1); // 900~1000 ms의 6개 / 0.2초 창의 11개
  });
});

describe('고도 (사양서 7.13)', () => {
  it('altAcc가 큰 점은 빼고 평활한다', () => {
    const rng = mulberry32(3);
    const gps: GpsSample[] = [];
    for (let k = 0; k < 120; k++) {
      gps.push({
        tRecv: k * 1000,
        tFix: k * 1000,
        lat: 0,
        lon: 0,
        alt: k === 60 ? 500 : 100 + gaussian(rng) * 4,
        altAcc: k === 60 ? 50 : 6,
        hAcc: 5,
        speed: 0,
        heading: null,
      });
    }
    const times = Float64Array.from({ length: 1200 }, (_, i) => i * 100);
    const alt = smoothAltitude(gps, times)!;
    expect(Math.max(...alt)).toBeLessThan(110);
    const mean = alt.reduce((a, b) => a + b, 0) / alt.length;
    const sd = Math.sqrt(alt.reduce((a, b) => a + (b - mean) ** 2, 0) / alt.length);
    expect(sd).toBeLessThan(2.5);
  });

  it('고도 값이 없으면 null', () => {
    expect(smoothAltitude([], new Float64Array(3))).toBeNull();
  });
});
