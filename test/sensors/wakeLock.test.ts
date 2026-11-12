import { describe, expect, it, vi } from 'vitest';
import {
  createWakeLockManager,
  type SentinelLike,
  type VisibilityLike,
  type WakeLockApiLike,
} from '../../src/sensors/wakeLock';

function fakeSentinel() {
  const listeners: Array<() => void> = [];
  const s: SentinelLike & { systemRelease(): void } = {
    released: false,
    release: vi.fn(async () => {
      s.released = true;
    }),
    addEventListener: (_type, cb) => {
      listeners.push(cb);
    },
    systemRelease() {
      s.released = true;
      listeners.forEach((l) => l());
    },
  };
  return s;
}

function fakeVisibility(): VisibilityLike & { set(v: boolean): void } {
  let visible = true;
  const listeners: Array<() => void> = [];
  return {
    isVisible: () => visible,
    onChange: (cb) => {
      listeners.push(cb);
      return () => {};
    },
    set(v) {
      visible = v;
      listeners.forEach((l) => l());
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createWakeLockManager', () => {
  it('API가 없으면 지원 안 함', async () => {
    const m = createWakeLockManager(undefined, fakeVisibility());
    expect(await m.acquire()).toBe('unsupported');
  });

  it('요청이 성공하면 켜짐', async () => {
    const api: WakeLockApiLike = { request: vi.fn(async () => fakeSentinel()) };
    const m = createWakeLockManager(api, fakeVisibility());
    expect(await m.acquire()).toBe('active');
    expect(m.getState()).toBe('active');
  });

  it('요청이 실패하면 실패', async () => {
    const api: WakeLockApiLike = { request: vi.fn(async () => Promise.reject(new Error('NotAllowed'))) };
    const m = createWakeLockManager(api, fakeVisibility());
    expect(await m.acquire()).toBe('failed');
  });

  it('화면이 가려져 시스템이 해제한 뒤, 다시 보이면 다시 요청한다', async () => {
    const sentinels: Array<ReturnType<typeof fakeSentinel>> = [];
    const api: WakeLockApiLike = {
      request: vi.fn(async () => {
        const s = fakeSentinel();
        sentinels.push(s);
        return s;
      }),
    };
    const vis = fakeVisibility();
    const m = createWakeLockManager(api, vis);
    await m.acquire();
    vis.set(false);
    sentinels[0]!.systemRelease();
    expect(m.getState()).toBe('off');
    vis.set(true);
    await flush();
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(m.getState()).toBe('active');
  });

  it('직접 해제한 뒤에는 화면이 다시 보여도 요청하지 않는다', async () => {
    const api: WakeLockApiLike = { request: vi.fn(async () => fakeSentinel()) };
    const vis = fakeVisibility();
    const m = createWakeLockManager(api, vis);
    await m.acquire();
    await m.release();
    vis.set(false);
    vis.set(true);
    await flush();
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(m.getState()).toBe('off');
  });

  it('해제 알림보다 "다시 보임"이 먼저 와도, 이미 풀린 잠금이면 다시 요청한다', async () => {
    const sentinels: Array<ReturnType<typeof fakeSentinel>> = [];
    const api: WakeLockApiLike = {
      request: vi.fn(async () => {
        const s = fakeSentinel();
        sentinels.push(s);
        return s;
      }),
    };
    const vis = fakeVisibility();
    const m = createWakeLockManager(api, vis);
    await m.acquire();
    sentinels[0]!.released = true; // 시스템이 풀었지만 release 알림은 아직
    vis.set(true);
    await flush();
    expect(api.request).toHaveBeenCalledTimes(2);
  });
});
