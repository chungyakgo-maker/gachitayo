// 주행 선 지도 손 동작을 메인 지도와 같게 (사용자 요청 2026-11-18 "주행중일땐 여전히 메인지도랑 동작이 다르잖아"):
// 지도 프로그램(MapLibre)이 끌기·두 손가락 확대/돌리기(손가락 기준)·관성을 직접 받는다. 두 번 탭은 화면 모드 바꾸기라 확대로 쓰지 않는다
import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const handlers: Record<string, Array<(e?: unknown) => void>> = {};
  const dom: Record<string, Array<(e: { touches: unknown[] }) => void>> = {};
  const calls: Array<{ fn: string; arg: unknown }> = [];
  const state = { zoom: 15, bearing: 0, moving: false, center: { lat: 37.5, lng: 127 } };
  const container = {
    addEventListener: (ev: string, fn: (e: { touches: unknown[] }) => void) => (dom[ev] ??= []).push(fn),
    removeEventListener: () => {},
  };
  const map = new Proxy(
    {
      on: (ev: string, fn: (e?: unknown) => void) => (handlers[ev] ??= []).push(fn),
      getZoom: () => state.zoom,
      getBearing: () => state.bearing,
      getCenter: () => state.center,
      isMoving: () => state.moving,
      getCanvasContainer: () => container,
      jumpTo: (o: { zoom?: number }) => {
        calls.push({ fn: 'jumpTo', arg: o });
        if (typeof o.zoom === 'number') state.zoom = o.zoom;
      },
      easeTo: (o: unknown) => calls.push({ fn: 'easeTo', arg: o }),
    } as Record<string, unknown>,
    { get: (t, k) => (k in t ? t[k as string] : () => {}) },
  );
  return {
    map,
    calls,
    state,
    opts: [] as unknown[],
    fire: (ev: string, e?: unknown) => handlers[ev]?.forEach((f) => f(e)),
    touch: (ev: string, n: number) => dom[ev]?.forEach((f) => f({ touches: Array.from({ length: n }) })),
  };
});
vi.mock('../../src/ui/map/lineMap', () => ({
  newLineMap: (_el: unknown, _cfg: unknown, opts: unknown) => {
    fake.opts.push(opts);
    return fake.map;
  },
  boundsOf: () => [[0, 0], [1, 1]],
}));

import { createLineReplayMap } from '../../src/ui/map/lineReplayMap';
import { lineZoom } from '../../src/ui/map/lineShapes';
import { FOLLOW_ZOOM } from '../../src/ui/map/mapTypes';

const inset = { top: 0, bottom: 0 };

describe('주행 선 지도: 메인 지도와 같은 손 동작', () => {
  it('손으로 움직일 수 있고(끌기·확대·돌리기), 두 번 탭 확대는 끈다', () => {
    createLineReplayMap(document.createElement('div'), {} as never);
    expect(fake.opts.at(-1)).toMatchObject({ interactive: true, rotate: true, doubleTapZoom: false });
  });

  it('손가락이 닿음 → 지도가 손으로 움직임 → 다 뗌(관성 끝)을 알리고, 그냥 누르기만 하면 움직임 없이 뗌', () => {
    const c = createLineReplayMap(document.createElement('div'), {} as never);
    const seen: string[] = [];
    c.onUser!((p) => seen.push(p));
    fake.touch('touchstart', 1);
    fake.touch('touchend', 0);
    expect(seen).toEqual(['down', 'up']);
    seen.length = 0;
    fake.touch('touchstart', 1);
    fake.fire('movestart', { originalEvent: {} });
    fake.fire('movestart', { originalEvent: {} });
    fake.state.moving = true;
    fake.touch('touchend', 0);
    expect(seen).toEqual(['down', 'moved']);
    fake.state.moving = false;
    fake.fire('moveend', { originalEvent: {} });
    expect(seen).toEqual(['down', 'moved', 'up']);
  });

  it('코드로 옮긴 것(jumpTo)은 손 동작으로 치지 않는다', () => {
    const c = createLineReplayMap(document.createElement('div'), {} as never);
    const seen: string[] = [];
    c.onUser!((p) => seen.push(p));
    fake.fire('movestart', {});
    fake.fire('moveend', {});
    expect(seen).toEqual([]);
  });

  it('손으로 옮긴 뒤 같은 자리로 따라가기를 다시 부르면 그 자리로 다시 옮긴다', () => {
    const c = createLineReplayMap(document.createElement('div'), {} as never);
    c.onUser!(() => {});
    c.track(37.5, 127, inset);
    fake.calls.length = 0;
    c.track(37.5, 127, inset);
    expect(fake.calls).toEqual([]);
    fake.touch('touchstart', 1);
    fake.fire('movestart', { originalEvent: {} });
    c.track(37.5, 127, inset);
    expect(fake.calls.at(-1)?.fn).toBe('jumpTo');
  });

  it('지금 카메라(가운데·확대 단계·방위)를 알려 주고, 둘러보는 중의 + / − 는 지도가 스르륵', () => {
    const c = createLineReplayMap(document.createElement('div'), {} as never);
    fake.state.zoom = lineZoom(FOLLOW_ZOOM) + 0.75;
    fake.state.bearing = 40;
    expect(c.camera!()).toEqual({ lat: 37.5, lon: 127, zoomOffset: 0.75, bearing: 40 });
    c.zoomBy!(1);
    expect(fake.calls.at(-1)).toMatchObject({ fn: 'easeTo', arg: { zoom: lineZoom(FOLLOW_ZOOM) + 1.75 } });
  });
});
