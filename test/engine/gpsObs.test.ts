import { describe, expect, it } from 'vitest';
import { LiveGpsObs, gpsPsiFromHeading, prepareGps } from '../../src/engine/fusion/gpsObs';
import { fromLocal } from '../../src/engine/geo';
import type { GpsSample } from '../../src/types/samples';

const origin = { lat: 37.2, lon: 127.1 };

const fix = (tRecv: number, x: number, y: number, over: Partial<GpsSample> = {}): GpsSample => {
  const ll = fromLocal(origin, x, y);
  return { tRecv, tFix: tRecv, lat: ll.lat, lon: ll.lon, alt: null, altAcc: null, hAcc: 5, speed: 10, heading: 90, ...over };
};

describe('GPS 관측 준비', () => {
  it('나침반 방향(북 0°, 시계 방향)을 동쪽 기준 반시계 각으로 바꾼다', () => {
    expect(gpsPsiFromHeading(0)).toBeCloseTo(Math.PI / 2, 12);
    expect(gpsPsiFromHeading(90)).toBeCloseTo(0, 12);
    expect(gpsPsiFromHeading(180)).toBeCloseTo(-Math.PI / 2, 12);
    expect(Math.abs(gpsPsiFromHeading(270))).toBeCloseTo(Math.PI, 12);
  });

  it('평면 좌표로 바꾸고 수신 시각 순서로 정렬한다', () => {
    const obs = prepareGps([fix(2000, 20, 0), fix(1000, 10, 5)], origin);
    expect(obs.map((o) => o.t)).toEqual([1000, 2000]);
    expect(obs[0]!.x).toBeCloseTo(10, 6);
    expect(obs[0]!.y).toBeCloseTo(5, 6);
    expect(obs[0]!.psi).toBeCloseTo(0, 12);
    expect(obs[0]!.speedDerived).toBe(false);
  });

  it('GPS 속도가 null이면 위치 차이로 계산하고 표시한다 (사양서 6.3)', () => {
    const obs = prepareGps(
      [0, 1, 2, 3].map((k) => fix(k * 1000, k * 12, 0, { speed: null, heading: null })),
      origin,
    );
    for (const o of obs) {
      expect(o.speedDerived).toBe(true);
      expect(o.speed).toBeCloseTo(12, 6);
      expect(o.psi).toBeNull();
    }
  });
});

describe('주행 중 GPS 관측 (과거 점만 사용)', () => {
  it('속도 값이 있으면 일괄 변환과 같고, 없으면 뒤쪽 2점 위치 차이로 속도를 계산한다', () => {
    const origin = { lat: 37.2, lon: 127.1 };
    const pts = Array.from({ length: 10 }, (_, i) => {
      const ll = fromLocal(origin, i * 20, 0);
      return { tRecv: i * 1000, tFix: i * 1000, lat: ll.lat, lon: ll.lon, alt: null, altAcc: null, hAcc: 5, speed: null, heading: 90 };
    });
    const live = new LiveGpsObs(origin);
    const out = pts.map((p) => live.push(p));
    expect(out[0]!.speed).toBe(0);
    expect(out[1]!.speed).toBeCloseTo(20, 6);
    expect(out[5]!.speed).toBeCloseTo(20, 6);
    expect(out.every((o) => o.speedDerived)).toBe(true);
    const withSpeed = pts.map((p) => ({ ...p, speed: 19.5 }));
    const live2 = new LiveGpsObs(origin);
    expect(withSpeed.map((p) => live2.push(p))).toEqual(prepareGps(withSpeed, origin));
  });
});
