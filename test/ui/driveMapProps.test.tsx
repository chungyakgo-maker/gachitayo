// 주행 화면이 지도(LiveMap)에 넘기는 값 (지도 그리기는 overlay.test.ts 에서 본다):
// 목적지 주행에서 지나온 경로 지우기 (사용자 요청 2026-11-17 "경로대로 가면 지나온 경로는 지워져야"), 내 차 표시 모양 (설정)
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { OverlayFrame } from '../../src/ui/overlay/frame';

const seen = vi.hoisted(() => ({ frames: [] as OverlayFrame[], markers: [] as unknown[] }));
vi.mock('../../src/ui/components/LiveMap', () => ({
  LiveMap: (p: { frame: OverlayFrame; marker?: unknown }) => {
    seen.frames.push(p.frame);
    seen.markers.push(p.marker);
    return null;
  },
}));

import { DriveView, type DriveViewProps } from '../../src/ui/screens/DriveScreen';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import type { NavLive } from '../../src/app/routeNav';
import { fromLocal } from '../../src/engine/geo';
import type { LiveSnapshot } from '../../src/engine/live/livePipeline';
import type { RouteStep } from '../../src/engine/route/routeGuide';
import { RouteGuide } from '../../src/engine/route/routeGuide';

const O = { lat: 37.5, lon: 127 };
const pts = (): Array<[number, number]> =>
  [0, 100, 200, 300].map((y) => {
    const p = fromLocal(O, 0, y);
    return [p.lat, p.lon];
  });
const guide = new RouteGuide(pts(), O);
const nav = (s: number | null, g: RouteGuide = guide): NavLive => ({
  guide: g,
  route: { distanceM: 300, durationS: 30, points: pts(), destName: null },
  step: { s, onRoute: s !== null, lateralM: 0, remainingM: s === null ? null : 300 - s, arrived: false, wantReroute: false } as RouteStep,
  status: s === null ? 'off' : 'guiding',
});
const snap = {
  t: 1000,
  state: null,
  frame: 'session',
  origin: O,
  utcOffsetMs: 0,
  pos: { x: 0, y: 120, psi: Math.PI / 2 },
  gps: { ready: true, hAcc: 4, ageMs: 300 },
  calibration: { state: 'calibrated', stillProgress: 1, signsConfirmed: true, motionActive: true },
  ghost: null,
  path: [],
  pathFrom: 0,
  pathDropped: 0,
} as unknown as LiveSnapshot;
const props = (p: Partial<DriveViewProps>): DriveViewProps => ({
  snap,
  course: null,
  refLap: null,
  mode: 'map',
  settings: DEFAULT_SETTINGS,
  replay: null,
  error: null,
  onCycle: () => {},
  onEnd: () => {},
  ...p,
});
const last = () => seen.frames.at(-1)!;

describe('목적지 주행 지도: 지나온 경로 지우기', () => {
  it('경로에서 지나온 거리를 지도에 넘기고, 잠깐 벗어나도 마지막 값을 그대로, 다시 찾은 새 경로는 처음부터', () => {
    const v = render(<DriveView {...props({ nav: nav(120) })} />);
    expect(last().routeS).toBe(120);
    v.rerender(<DriveView {...props({ nav: nav(null) })} />);
    expect(last().routeS).toBe(120);
    const g2 = new RouteGuide(pts(), O);
    v.rerender(<DriveView {...props({ nav: nav(null, g2) })} />);
    expect(last().routeS ?? null).toBeNull();
  });

  it('코스 주행에는 넘기지 않는다 (지나온 코스 선은 지금처럼 옅게)', () => {
    render(<DriveView {...props({ nav: null })} />);
    expect(last().routeS ?? null).toBeNull();
  });
});

describe('내 차 표시 (설정)', () => {
  it('설정에서 고른 모양을 지도에 넘긴다', () => {
    render(<DriveView {...props({ settings: { ...DEFAULT_SETTINGS, carMarker: 'red' } })} />);
    expect(seen.markers.at(-1)).toBe('red');
  });
});
