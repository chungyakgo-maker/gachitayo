import { describe, expect, it } from 'vitest';
import { createSessionClock } from '../../src/normalize/sessionClock';

describe('createSessionClock', () => {
  it('세션 시작 시점은 0이고, 단조 시계가 흐른 만큼 늘어난다', () => {
    let perf = 12_345;
    const startedAt = 1_800_000_000_000;
    const clock = createSessionClock(startedAt, () => perf, () => startedAt);
    expect(clock.now()).toBe(0);
    perf += 1500;
    expect(clock.now()).toBe(1500);
  });

  it('이어서 하기: 새 페이지의 단조 시계가 0부터 시작해도, 벽시계 차이만큼 띄워서 이어진다', () => {
    const startedAt = 1_800_000_000_000;
    let perf = 0;
    const clock = createSessionClock(startedAt, () => perf, () => startedAt + 60_000);
    expect(clock.now()).toBe(60_000);
    perf += 250;
    expect(clock.now()).toBe(60_250);
  });
});
