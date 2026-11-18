// 메인 선 지도 (2026-11-18): 두 손가락 돌리기를 켜고, 손으로 옮기거나 돌리면 알리고, GPS(내 위치로)는 내 위치·기본 확대·북쪽 위
import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const handlers: Record<string, Array<(e?: unknown) => void>> = {};
  const calls: Array<{ fn: string; arg: unknown }> = [];
  let bearing = 0;
  const map = new Proxy(
    {
      on: (ev: string, a: unknown, b?: unknown) => {
        const fn = (typeof a === 'function' ? a : b) as (e?: unknown) => void;
        (handlers[ev] ??= []).push(fn);
      },
      getBearing: () => bearing,
      getZoom: () => 10,
      easeTo: (o: { bearing?: number }) => {
        calls.push({ fn: 'easeTo', arg: o });
        if (typeof o.bearing === 'number') bearing = o.bearing;
      },
      jumpTo: (o: unknown) => calls.push({ fn: 'jumpTo', arg: o }),
    } as Record<string, unknown>,
    { get: (t, k) => (k in t ? t[k as string] : () => {}) },
  );
  return {
    map,
    calls,
    opts: [] as unknown[],
    fire: (ev: string, e?: unknown) => handlers[ev]?.forEach((f) => f(e)),
    setBearing: (b: number) => (bearing = b),
  };
});
vi.mock('../../src/ui/map/lineMap', () => ({
  newLineMap: (_el: unknown, _cfg: unknown, opts: unknown) => {
    fake.opts.push(opts);
    return fake.map;
  },
  addCourseLayers: () => ({}),
  boundsOf: () => [[0, 0], [1, 1]],
  emptyFC: () => ({ type: 'FeatureCollection', features: [] }),
  setData: () => {},
}));
vi.mock('maplibre-gl', () => ({ Marker: class {} }));

import { createLineMainMap } from '../../src/ui/map/lineMainMap';
import { lineZoom } from '../../src/ui/map/lineShapes';

describe('메인 선 지도 손 동작', () => {
  it('두 손가락 돌리기를 켜고, 옮기거나 돌리면 알리고, 내 위치로는 기본 확대·북쪽 위', () => {
    const m = createLineMainMap(document.createElement('div'), {} as never);
    expect(fake.opts.at(-1)).toMatchObject({ rotate: true });
    const seen: Array<{ away: boolean; bearing: number }> = [];
    m.onView!((v) => seen.push(v));
    fake.fire('dragstart');
    fake.setBearing(30);
    fake.fire('rotate');
    expect(seen.at(-1)).toEqual({ away: true, bearing: 30 });
    m.locate({ lat: 37.5, lon: 127, hAcc: 5 });
    const ease = fake.calls.filter((c) => c.fn === 'easeTo').at(-1)!.arg as { zoom: number; bearing: number; center: [number, number] };
    expect(ease).toMatchObject({ zoom: lineZoom(16), bearing: 0, center: [127, 37.5] });
    expect(seen.at(-1)).toEqual({ away: false, bearing: 0 });
    fake.setBearing(45);
    m.resetNorth!();
    expect((fake.calls.at(-1)!.arg as { bearing: number }).bearing).toBe(0);
  });
});
