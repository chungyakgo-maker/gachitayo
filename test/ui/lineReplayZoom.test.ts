// 주행 선 지도 확대 (2026-11-17 "부드럽게 확대·축소"): 두 손가락·+ / − 가 매 프레임 넘기는 소수 확대를 바로 반영한다.
// 전체 코스 보기에서도 (맞춘 확대 + 더한 만큼), 따라가기는 다음 프레임 자리 옮길 때
import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const calls: Array<Record<string, unknown>> = [];
  let zoom = 10;
  const map = {
    jumpTo: (o: Record<string, unknown>) => {
      calls.push(o);
      if (typeof o.zoom === 'number') zoom = o.zoom;
    },
    fitBounds: () => {
      zoom = 12;
    },
    getZoom: () => zoom,
    resize: () => {},
    project: () => ({ x: 0, y: 0 }),
    remove: () => {},
  };
  return { calls, map };
});
vi.mock('../../src/ui/map/lineMap', () => ({ newLineMap: () => fake.map, boundsOf: () => [[0, 0], [1, 1]] }));

import { createLineReplayMap } from '../../src/ui/map/lineReplayMap';
import { lineZoom } from '../../src/ui/map/lineShapes';
import { FOLLOW_ZOOM } from '../../src/ui/map/mapTypes';

const cfg = {} as Parameters<typeof createLineReplayMap>[1];
const inset = { top: 0, bottom: 0 };

describe('주행 선 지도 확대', () => {
  it('전체 코스: 맞춘 확대에 소수 확대를 바로 더한다', () => {
    const c = createLineReplayMap(document.createElement('div'), cfg);
    c.fit([[37.5, 127], [37.6, 127.1]], inset);
    fake.calls.length = 0;
    c.setZoomOffset!(0.5);
    expect(fake.calls.at(-1)?.zoom).toBeCloseTo(12.5, 6);
    c.setZoomOffset!(-1.25);
    expect(fake.calls.at(-1)?.zoom).toBeCloseTo(10.75, 6);
  });

  it('따라가기: 다음에 자리를 옮길 때 소수 확대로', () => {
    const c = createLineReplayMap(document.createElement('div'), cfg);
    c.track(37.5, 127, inset);
    fake.calls.length = 0;
    c.setZoomOffset!(0.3);
    expect(fake.calls).toEqual([]);
    c.track(37.5, 127, inset);
    expect(fake.calls.at(-1)?.zoom).toBeCloseTo(lineZoom(FOLLOW_ZOOM) + 0.3, 6);
  });
});
