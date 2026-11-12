import { describe, expect, it } from 'vitest';
import { toGpsSample, toRawMotionSample, type PositionLike } from '../../src/normalize/sensorSamples';

const position = (coords: Partial<PositionLike['coords']> = {}): PositionLike => ({
  timestamp: 1_800_000_000_123,
  coords: {
    latitude: 37.5665,
    longitude: 126.978,
    altitude: 38.2,
    accuracy: 4.5,
    altitudeAccuracy: 6.1,
    speed: 12.3,
    heading: 270,
    ...coords,
  },
});

describe('toGpsSample', () => {
  it('위치 정보를 GpsSample 필드로 옮긴다', () => {
    expect(toGpsSample(position(), 5000)).toEqual({
      tRecv: 5000,
      tFix: 1_800_000_000_123,
      lat: 37.5665,
      lon: 126.978,
      alt: 38.2,
      altAcc: 6.1,
      hAcc: 4.5,
      speed: 12.3,
      heading: 270,
    });
  });

  it('없는 값은 null로 둔다', () => {
    const s = toGpsSample(
      position({ altitude: null, altitudeAccuracy: null, speed: null, heading: null }),
      0,
    );
    expect([s.alt, s.altAcc, s.speed, s.heading]).toEqual([null, null, null, null]);
  });

  it('정지해서 방향이 NaN이면 null로 둔다', () => {
    expect(toGpsSample(position({ heading: Number.NaN }), 0).heading).toBeNull();
  });

  it('속도가 음수(일부 기기의 "모름" 표시)면 null로 둔다', () => {
    expect(toGpsSample(position({ speed: -1 }), 0).speed).toBeNull();
  });
});

describe('toRawMotionSample', () => {
  const gravity = { x: 0.1, y: -9.7, z: 0.3 };

  it('회전 속도를 deg/s에서 rad/s로 바꾸고, beta→rx, gamma→ry, alpha→rz로 대응시킨다', () => {
    const s = toRawMotionSample(
      { accelerationIncludingGravity: gravity, rotationRate: { alpha: 90, beta: 180, gamma: -45 } },
      20,
    );
    expect(s).not.toBeNull();
    expect(s!.t).toBe(20);
    expect([s!.gax, s!.gay, s!.gaz]).toEqual([0.1, -9.7, 0.3]);
    expect(s!.rx).toBeCloseTo(Math.PI, 12);
    expect(s!.ry).toBeCloseTo(-Math.PI / 4, 12);
    expect(s!.rz).toBeCloseTo(Math.PI / 2, 12);
  });

  it('중력 포함 가속도가 없으면 샘플을 만들지 않는다', () => {
    expect(
      toRawMotionSample({ accelerationIncludingGravity: null, rotationRate: { alpha: 1, beta: 1, gamma: 1 } }, 0),
    ).toBeNull();
    expect(
      toRawMotionSample({ accelerationIncludingGravity: { x: null, y: 1, z: 1 }, rotationRate: null }, 0),
    ).toBeNull();
  });

  it('자이로가 없는 기기는 회전 속도를 null로 둔다', () => {
    const s = toRawMotionSample({ accelerationIncludingGravity: gravity, rotationRate: null }, 0);
    expect([s!.rx, s!.ry, s!.rz]).toEqual([null, null, null]);
  });
});
