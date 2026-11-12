import { describe, expect, it } from 'vitest';
import { PoseLerp, smoothAngleStep } from '../../../src/ui/overlay/poseLerp';

describe('지도 부드럽게 (사용자 요청: 뚝뚝 끊김) — 1초에 10번 온 위치를 사이사이 이어 그리기', () => {
  it('0.1초 늦게, 두 위치 사이를 시간에 비례해 잇는다', () => {
    const l = new PoseLerp();
    l.push(0, { x: 0, y: 0, psi: 0 });
    l.push(100, { x: 3, y: 0, psi: 0 });
    expect(l.sample(100)).toEqual({ x: 0, y: 0, psi: 0 });
    expect(l.sample(150)!.x).toBeCloseTo(1.5, 9);
    expect(l.sample(200)!.x).toBeCloseTo(3, 9);
    // 다음 위치가 늦으면 반 칸까지만 늘리고 멈춘다
    expect(l.sample(260)!.x).toBeCloseTo(4.5, 9);
    expect(l.sample(400)!.x).toBeCloseTo(4.5, 9);
  });

  it('같은 위치가 다시 오면(다시 그리기) 무시하고, 크게 튀면 잇지 않는다', () => {
    const l = new PoseLerp();
    l.push(0, { x: 0, y: 0 });
    l.push(100, { x: 3, y: 0 });
    l.push(120, { x: 3, y: 0 });
    expect(l.sample(150)!.x).toBeCloseTo(1.5, 9);
    l.push(200, { x: 900, y: 0 });
    expect(l.sample(250)).toEqual({ x: 900, y: 0, psi: undefined });
    l.push(300, null);
    expect(l.sample(350)).toBeNull();
  });

  it('진행 방향은 짧은 쪽으로 잇고(±π 넘어감), 지수 평활도 짧은 쪽으로', () => {
    const l = new PoseLerp();
    l.push(0, { x: 0, y: 0, psi: Math.PI - 0.1 });
    l.push(100, { x: 1, y: 0, psi: -Math.PI + 0.1 });
    const mid = l.sample(150)!.psi!;
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9);
    const s = smoothAngleStep(Math.PI - 0.1, -Math.PI + 0.1, 250, 250)!;
    expect(Math.cos(s)).toBeLessThan(-0.99);
    expect(smoothAngleStep(null, 1, 16, 250)).toBe(1);
    expect(smoothAngleStep(0.5, null, 16, 250)).toBe(0.5);
  });
});
