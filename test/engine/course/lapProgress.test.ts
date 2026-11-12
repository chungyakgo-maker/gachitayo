import { describe, expect, it } from 'vitest';
import { LapProgress } from '../../../src/engine/course/lapProgress';

describe('랩 안 코스 거리 (출발선 근처 넘어감 처리)', () => {
  it('랩 밖이면 그대로', () => {
    expect(new LapProgress(1000).map(995, false)).toBe(995);
  });

  it('보통 길이 코스: 출발 직후 둘레 끝으로 읽히면 0, 끝나기 직전 0 근처로 읽히면 둘레 끝', () => {
    const p = new LapProgress(1000);
    expect(p.map(995, true)).toBe(0);
    expect(p.map(10, true)).toBe(10);
    expect(p.map(600, true)).toBe(600);
    expect(p.map(990, true)).toBe(990);
    expect(p.map(3, true)).toBe(1000);
  });

  it('출발선 바로 뒤에 10초 넘게 서 있어도(둘레 끝으로 읽힘) 0', () => {
    const p = new LapProgress(1000);
    expect(p.map(998, true)).toBe(0);
  });

  it('짧은 코스(80 m): 랩 중간의 코스 거리를 0으로 바꾸지 않는다', () => {
    const p = new LapProgress(80);
    expect(p.map(10, true)).toBe(10);
    expect(p.map(20, true)).toBe(20);
    expect(p.map(35, true)).toBe(35);
    expect(p.map(49, true)).toBe(49);
    expect(p.map(78, true)).toBe(78);
  });
});
