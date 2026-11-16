// 실시간 인기 신호 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md): 기본 코스로 주행 중이면 2분마다, 위치 없이
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ state: { phase: 'idle', replay: null, course: null } as Record<string, unknown>, cb: null as null | (() => void) }));
vi.mock('../../src/app/drive', () => ({
  getDriveState: () => h.state,
  subscribeDrive: (cb: () => void) => {
    h.cb = cb;
    return () => {
      h.cb = null;
    };
  },
}));
vi.mock('../../src/app/account', () => ({ getAuth: () => ({ userId: 'u1', token: 'tok' }) }));
const posts: unknown[] = [];
beforeEach(() => {
  posts.length = 0;
  h.state = { phase: 'idle', replay: null, course: null };
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init: RequestInit) => {
      posts.push(JSON.parse(String(init.body)));
      return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const { startDrivingSignal } = await import('../../src/app/drivingSignal');

describe('drivingSignal', () => {
  it('sends the built-in key every 2 minutes while driving it, then stops', async () => {
    const stop = startDrivingSignal();
    h.state = { phase: 'driving', replay: null, course: { builtin: 'haogogae' } };
    h.cb!();
    await vi.advanceTimersByTimeAsync(10);
    expect(posts).toEqual([{ builtin: 'haogogae' }]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(posts).toHaveLength(2);
    h.state = { phase: 'idle', replay: null, course: null };
    h.cb!();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(posts).toHaveLength(2);
    stop();
  });

  it('nothing for own courses, free drives or replays', async () => {
    const stop = startDrivingSignal();
    for (const s of [
      { phase: 'driving', replay: null, course: { builtin: null } },
      { phase: 'driving', replay: null, course: null },
      { phase: 'driving', replay: { label: 'x' }, course: { builtin: 'haogogae' } },
    ]) {
      h.state = s;
      h.cb!();
      await vi.advanceTimersByTimeAsync(130_000);
    }
    expect(posts).toEqual([]);
    stop();
  });
});
