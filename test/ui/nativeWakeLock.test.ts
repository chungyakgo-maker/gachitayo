import { beforeEach, describe, expect, it, vi } from 'vitest';

// 아이폰 앱 디고 (사양서 13.3): 화면 꺼짐 방지는 앱 플러그인
const keepAwake = vi.fn(async () => {});
const allowSleep = vi.fn(async () => {});
vi.mock('@capacitor-community/keep-awake', () => ({ KeepAwake: { keepAwake: (...a: unknown[]) => keepAwake(...(a as [])), allowSleep: (...a: unknown[]) => allowSleep(...(a as [])) } }));
vi.mock('../../src/platform', () => ({ isApp: () => true }));

describe('화면 꺼짐 방지 (아이폰 앱)', () => {
  beforeEach(() => {
    keepAwake.mockReset().mockResolvedValue(undefined);
    allowSleep.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
  });

  it('켜면 keepAwake 한 번, 끄면 allowSleep 한 번 (브라우저 Wake Lock이 없어도)', async () => {
    const { createBrowserWakeLockManager } = await import('../../src/sensors/wakeLock');
    const m = createBrowserWakeLockManager();
    expect(await m.acquire()).toBe('active');
    expect(keepAwake).toHaveBeenCalledTimes(1);
    await m.release();
    expect(allowSleep).toHaveBeenCalledTimes(1);
    expect(m.getState()).toBe('off');
  });

  it('플러그인이 거절하면 failed', async () => {
    keepAwake.mockRejectedValue(new Error('no'));
    const { createBrowserWakeLockManager } = await import('../../src/sensors/wakeLock');
    expect(await createBrowserWakeLockManager().acquire()).toBe('failed');
  });
});
