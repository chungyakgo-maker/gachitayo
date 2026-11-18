// 주행 지도(선 지도)의 손 동작은 메인 지도와 같은 지도 프로그램이 직접 받는다 (사용자 요청 2026-11-18 "메인지도랑 동작이 다르잖아"):
// 손으로 움직이면 따라가기를 멈추고 GPS 버튼이 "내 위치로", 다 떼고 3초 뒤(또는 누르면) 내 위치·평소 주행 확대·나침반 보기대로
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReplayMapController } from '../../src/ui/map/mapTypes';

const h = vi.hoisted(() => ({
  user: null as ((p: 'down' | 'moved' | 'up') => void) | null,
  camera: vi.fn(() => ({ lat: 37.5005, lon: 127.0005, zoomOffset: 1.3, bearing: 35 })),
  zoomBy: vi.fn(),
  track: vi.fn(),
  fit: vi.fn(),
}));
vi.mock('../../src/ui/map/lineMapSupport', () => ({ lineMapConfig: async () => ({ tiles: '', glyphs: '', maxzoom: 14 }) }));
vi.mock('../../src/ui/map/lineReplayMap', () => ({
  createLineReplayMap: (): ReplayMapController =>
    new Proxy(
      {
        nativeRotate: true,
        onUser: (cb: typeof h.user) => {
          h.user = cb;
        },
        camera: h.camera,
        zoomBy: h.zoomBy,
        track: h.track,
        trackHeading: h.track,
        fit: h.fit,
        project: () => ({ x: 0, y: 0 }),
      } as unknown as ReplayMapController,
      { get: (t, k) => (k in t ? (t as unknown as Record<string, unknown>)[k as string] : () => {}) },
    ),
}));

import { DriveView, type DriveViewProps } from '../../src/ui/screens/DriveScreen';
import { getSettings, updateSettings } from '../../src/app/settings';
import type { LiveSnapshot } from '../../src/engine/live/livePipeline';

const snap = {
  t: 1000,
  state: null,
  frame: 'session',
  origin: { lat: 37.5, lon: 127 },
  utcOffsetMs: 0,
  pos: { x: 0, y: 0, psi: 0 },
  gps: { ready: true, hAcc: 4, ageMs: 300 },
  calibration: { state: 'calibrated', stillProgress: 1, signsConfirmed: true, motionActive: true },
  ghost: null,
  path: [],
  pathFrom: 0,
  pathDropped: 0,
} as unknown as LiveSnapshot;
const onCycle = vi.fn();
const props = (): DriveViewProps => ({ snap, course: null, refLap: null, mode: 'map', settings: getSettings(), replay: null, error: null, onCycle, onEnd: () => {} });
const gps = () => screen.getByRole('button', { name: /^내 위치로/ });

beforeEach(() => {
  cleanup();
  h.user = null;
  h.camera.mockClear();
  h.zoomBy.mockClear();
  onCycle.mockClear();
  updateSettings({ driveZoom: 0.5, mapView: 'heading', mapTiles: true });
});
afterEach(() => vi.useRealTimers());

describe('주행 선 지도 손 동작 = 메인 지도', () => {
  it('지도 위 그림(캔버스)은 손가락을 지도에 넘긴다', async () => {
    const { container } = render(<DriveView {...props()} />);
    await waitFor(() => expect(h.user).not.toBeNull());
    expect((container.querySelector('canvas.overlay-layer') as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('그냥 누르기만 하면 그대로, 손으로 움직이면 "내 위치로", 다 떼고 3초 뒤 지금 카메라에서 내 위치로 돌아온다', async () => {
    render(<DriveView {...props()} />);
    await waitFor(() => expect(h.user).not.toBeNull());
    vi.useFakeTimers();
    act(() => {
      h.user!('down');
      h.user!('up');
    });
    expect(gps()).not.toHaveTextContent('내 위치로');
    act(() => {
      h.user!('down');
      h.user!('moved');
    });
    expect(gps()).toHaveTextContent('내 위치로');
    act(() => h.user!('up'));
    act(() => vi.advanceTimersByTime(2900));
    expect(gps()).toHaveTextContent('내 위치로');
    act(() => vi.advanceTimersByTime(200));
    expect(gps()).not.toHaveTextContent('내 위치로');
    expect(h.camera).toHaveBeenCalled();
    expect(getSettings().driveZoom).toBe(0.5);
  });

  it('다시 손을 대면 3초를 새로 센다, GPS 버튼을 누르면 바로 돌아온다', async () => {
    render(<DriveView {...props()} />);
    await waitFor(() => expect(h.user).not.toBeNull());
    vi.useFakeTimers();
    act(() => {
      h.user!('down');
      h.user!('moved');
      h.user!('up');
    });
    act(() => vi.advanceTimersByTime(2500));
    act(() => h.user!('down'));
    act(() => vi.advanceTimersByTime(3500));
    expect(gps()).toHaveTextContent('내 위치로');
    act(() => h.user!('up'));
    fireEvent.click(gps());
    expect(gps()).not.toHaveTextContent('내 위치로');
  });

  it('둘러보는 중의 + / − 는 지도만 (저장 안 함)', async () => {
    render(<DriveView {...props()} />);
    await waitFor(() => expect(h.user).not.toBeNull());
    act(() => {
      h.user!('down');
      h.user!('moved');
    });
    fireEvent.click(screen.getByRole('button', { name: '지도 확대' }));
    expect(h.zoomBy).toHaveBeenCalledWith(1);
    expect(getSettings().driveZoom).toBe(0.5);
  });

  it('전체 코스 보기에서도 메인처럼 옮길 수 있고, 돌아오면 다시 코스 전체로 맞춘다', async () => {
    updateSettings({ mapView: 'fit' });
    render(<DriveView {...props()} />);
    await waitFor(() => expect(h.user).not.toBeNull());
    act(() => {
      h.user!('down');
      h.user!('moved');
    });
    expect(gps()).toHaveTextContent('내 위치로');
    const before = h.fit.mock.calls.length;
    fireEvent.click(gps());
    await waitFor(() => expect(h.fit.mock.calls.length).toBeGreaterThan(before));
  });
});
