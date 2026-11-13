import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GpsSample } from '../../src/types/samples';

// 아이폰 앱 디고 (사양서 13.3): 주행 기록은 백그라운드 위치 플러그인, 메인 화면 미리보기는 앞에 있을 때만
type Cb = (position?: Record<string, unknown>, error?: { code?: string; message?: string }) => void;
let cb: Cb | null = null;
let resolveAdd: ((id: string) => void) | null = null;
const plugin = {
  addWatcher: vi.fn((_opts: unknown, c: Cb) => {
    cb = c;
    return new Promise<string>((res) => (resolveAdd = res));
  }),
  removeWatcher: vi.fn(async (_o: { id: string }) => {}),
};
vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }));
let app = true;
vi.mock('../../src/platform', () => ({ isApp: () => app }));

const clock = { now: () => 1234 } as unknown as Parameters<typeof import('../../src/sensors/gps').startGps>[0];
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('백그라운드 위치 (아이폰 앱, 사양서 13.3)', () => {
  const watch = vi.fn(() => 7);
  const clear = vi.fn();
  beforeEach(() => {
    cb = null;
    resolveAdd = null;
    app = true;
    plugin.addWatcher.mockClear();
    plugin.removeWatcher.mockClear();
    watch.mockClear();
    clear.mockClear();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, clearWatch: clear } });
  });
  afterEach(() => vi.useRealTimers());

  it('플러그인 위치를 GPS 표본으로 (방위 → 진행 방향, 음수 속도 → 모름, 기록 시각)', async () => {
    const { startNativeGps } = await import('../../src/sensors/nativeGps');
    const got: GpsSample[] = [];
    startNativeGps(clock, (s) => got.push(s), () => {});
    expect(plugin.addWatcher).toHaveBeenCalledWith(
      { backgroundTitle: '디고 주행 기록 중', backgroundMessage: '화면이 꺼져도 위치를 기록해요', requestPermissions: true, stale: false, distanceFilter: 0 },
      expect.any(Function),
    );
    cb!({ latitude: 37.5, longitude: 127.1, accuracy: 4, altitude: 50, altitudeAccuracy: 3, simulated: false, speed: -1, bearing: 90, time: 1700000000000 });
    expect(got).toEqual([{ tRecv: 1234, tFix: 1700000000000, lat: 37.5, lon: 127.1, alt: 50, altAcc: 3, hAcc: 4, speed: null, heading: 90 }]);
  });

  it('권한 거절은 denied, 그 밖의 오류는 unavailable', async () => {
    const { startNativeGps } = await import('../../src/sensors/nativeGps');
    const errs: string[] = [];
    startNativeGps(clock, () => {}, (e) => errs.push(e));
    cb!(undefined, { code: 'NOT_AUTHORIZED', message: 'x' });
    cb!(undefined, { message: 'other' });
    expect(errs).toEqual(['denied', 'unavailable']);
  });

  it('감시를 시작하는 응답보다 멈춤이 먼저 와도 응답이 오면 그 감시를 끈다 (주행 끝난 뒤 위치가 계속 켜지지 않게)', async () => {
    const { startNativeGps } = await import('../../src/sensors/nativeGps');
    const stop = startNativeGps(clock, () => {}, () => {});
    stop();
    expect(plugin.removeWatcher).not.toHaveBeenCalled();
    resolveAdd!('w1');
    await flush();
    expect(plugin.removeWatcher).toHaveBeenCalledTimes(1);
    expect(plugin.removeWatcher).toHaveBeenCalledWith({ id: 'w1' });
    // 멈춘 뒤 온 위치는 버린다
    stop();
    expect(plugin.removeWatcher).toHaveBeenCalledTimes(1);
  });

  it('응답 뒤 멈추면 바로 끈다', async () => {
    const { startNativeGps } = await import('../../src/sensors/nativeGps');
    const got: unknown[] = [];
    const stop = startNativeGps(clock, (s) => got.push(s), () => {});
    resolveAdd!('w2');
    await flush();
    stop();
    expect(plugin.removeWatcher).toHaveBeenCalledWith({ id: 'w2' });
    cb!({ latitude: 1, longitude: 2, accuracy: 5, altitude: null, altitudeAccuracy: null, simulated: false, speed: 3, bearing: null, time: null });
    expect(got).toEqual([]);
  });

  it('앱: 주행 기록(background)은 백그라운드 위치, 메인 화면 미리보기는 앞에 있을 때만(백그라운드 문구 없이, 권한 창 없이) — 앱을 내려도 GPS가 돌지 않게', async () => {
    const { startGps } = await import('../../src/sensors/gps');
    startGps(clock, () => {}, () => {}, { background: true });
    expect(plugin.addWatcher.mock.calls[0]![0]).toMatchObject({ backgroundMessage: expect.any(String), requestPermissions: true });
    startGps(clock, () => {}, () => {});
    const fg = plugin.addWatcher.mock.calls[1]![0] as Record<string, unknown>;
    expect(fg.backgroundMessage).toBeUndefined();
    expect(fg.requestPermissions).toBe(false);
    expect(watch).not.toHaveBeenCalled();
  });

  it('WebView가 다시 열려(메모리 부족 등) 잃어버린 감시는 앱 시작 때 끈다 (백그라운드 위치가 계속 켜지지 않게)', async () => {
    const { startNativeGps, cleanupNativeGps } = await import('../../src/sensors/nativeGps');
    localStorage.clear();
    startNativeGps(clock, () => {}, () => {});
    resolveAdd!('w9');
    await flush();
    // 다시 열린 페이지: 이 감시는 JS가 모른다
    vi.resetModules();
    const again = await import('../../src/sensors/nativeGps');
    await again.cleanupNativeGps();
    expect(plugin.removeWatcher).toHaveBeenCalledWith({ id: 'w9' });
    plugin.removeWatcher.mockClear();
    await cleanupNativeGps();
    expect(plugin.removeWatcher).not.toHaveBeenCalled();
  });

  it('제대로 멈춘 감시는 다음 시작 때 다시 끄지 않는다', async () => {
    const { startNativeGps, cleanupNativeGps } = await import('../../src/sensors/nativeGps');
    localStorage.clear();
    const stop = startNativeGps(clock, () => {}, () => {});
    resolveAdd!('w10');
    await flush();
    stop();
    plugin.removeWatcher.mockClear();
    await cleanupNativeGps();
    expect(plugin.removeWatcher).not.toHaveBeenCalled();
  });

  it('앱: 위치 권한은 위치를 한 번 받기 전에는 모름, 받은 뒤에는 허용(메인 화면 미리보기가 켜진다), 거절되면 다시 모름. 웹은 브라우저 값', async () => {
    localStorage.clear();
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'denied' }) } });
    const { queryLocationPermission } = await import('../../src/sensors/permissions');
    const { startNativeGps } = await import('../../src/sensors/nativeGps');
    expect(await queryLocationPermission()).toBe('unknown');
    startNativeGps(clock, () => {}, () => {});
    cb!({ latitude: 1, longitude: 2, accuracy: 5, altitude: null, altitudeAccuracy: null, simulated: false, speed: 3, bearing: null, time: 1 });
    expect(await queryLocationPermission()).toBe('granted');
    cb!(undefined, { code: 'NOT_AUTHORIZED' });
    expect(await queryLocationPermission()).toBe('unknown');
    app = false;
    expect(await queryLocationPermission()).toBe('denied');
  });

  it('웹: background여도 지금처럼 웹 위치', async () => {
    app = false;
    const { startGps } = await import('../../src/sensors/gps');
    startGps(clock, () => {}, () => {}, { background: true });
    expect(plugin.addWatcher).not.toHaveBeenCalled();
    expect(watch).toHaveBeenCalledTimes(1);
  });
});
