// 주행 지도 확대·축소 (사용자 요청 "주행 모드중 지도 축소나 확대 할수 있게"): 오른쪽 + / −, 단계는 남고, 두 번 탭(모드 바꾸기)으로 치지 않는다.
// 2026-11-17 "부드럽게 확대·축소가 안 되고 뚝뚝 끊겨", "손으로 지도 회전이 안 돼": 두 손가락은 손가락을 따라 연속으로, 비틀면 지도가 돈다
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DriveView, type DriveViewProps } from '../../src/ui/screens/DriveScreen';
import { getSettings, updateSettings } from '../../src/app/settings';
import type { LiveSnapshot } from '../../src/engine/live/livePipeline';

const snap: LiveSnapshot = {
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
};
const onCycle = vi.fn();
const props = (): DriveViewProps => ({ snap, course: null, refLap: null, mode: 'map', settings: getSettings(), replay: null, error: null, onCycle, onEnd: () => {} });

beforeEach(() => {
  cleanup();
  onCycle.mockClear();
  updateSettings({ driveZoom: 0, mapView: 'fit' });
});

describe('주행 지도 + / −', () => {
  it('zooms in up to +2 and out down to -4, and remembers it', () => {
    const { rerender } = render(<DriveView {...props()} />);
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: '지도 확대' }));
      rerender(<DriveView {...props()} />);
    }
    expect(getSettings().driveZoom).toBe(2);
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeDisabled();
    for (let i = 0; i < 9; i++) {
      fireEvent.click(screen.getByRole('button', { name: '지도 축소' }));
      rerender(<DriveView {...props()} />);
    }
    expect(getSettings().driveZoom).toBe(-4);
    expect(screen.getByRole('button', { name: '지도 축소' })).toBeDisabled();
  });

  it('quick taps on the zoom buttons do not switch the screen mode', () => {
    render(<DriveView {...props()} />);
    const plus = screen.getByRole('button', { name: '지도 확대' });
    fireEvent.pointerDown(plus, { clientX: 300, clientY: 300 });
    fireEvent.pointerDown(plus, { clientX: 300, clientY: 300 });
    expect(onCycle).not.toHaveBeenCalled();
  });

  it('pinching follows the fingers continuously (no steps) and keeps the zoom when the fingers lift', () => {
    const { container, rerender } = render(<DriveView {...props()} />);
    const map = container.querySelector('.drive-map .replay-map, .drive-map .live-map')!;
    const t = (d: number) => [
      { clientX: 100, clientY: 300, identifier: 0 },
      { clientX: 100 + d, clientY: 300, identifier: 1 },
    ];
    fireEvent.touchStart(map, { touches: t(100) });
    fireEvent.touchMove(map, { touches: t(141.421356) });
    fireEvent.touchMove(map, { touches: t(200) });
    fireEvent.touchMove(map, { touches: t(282.842712) });
    fireEvent.touchEnd(map, { touches: [] });
    expect(getSettings().driveZoom).toBeCloseTo(1.5, 2);
    rerender(<DriveView {...props()} />);
    fireEvent.touchStart(map, { touches: t(100) });
    fireEvent.touchMove(map, { touches: t(70.710678) });
    fireEvent.touchEnd(map, { touches: [] });
    expect(getSettings().driveZoom).toBeCloseTo(1, 2);
    expect(onCycle).not.toHaveBeenCalled();
  });

  it('+ / − still move one whole step from a pinched zoom', () => {
    updateSettings({ driveZoom: 0.5 });
    render(<DriveView {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '지도 확대' }));
    expect(getSettings().driveZoom).toBeCloseTo(1.5, 6);
  });

  it('only on the map screen', () => {
    render(<DriveView {...props()} mode="minimal" />);
    expect(screen.queryByRole('button', { name: '지도 확대' })).toBeNull();
  });
});

describe('두 손가락으로 지도 돌리기', () => {
  const t = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return [
      { clientX: 200 - Math.cos(a) * 60, clientY: 300 - Math.sin(a) * 60, identifier: 0 },
      { clientX: 200 + Math.cos(a) * 60, clientY: 300 + Math.sin(a) * 60, identifier: 1 },
    ];
  };
  const compass = () => screen.getByRole('button', { name: /^지도 보기/ });

  it('진행 방향 위에서 비틀면 자동 회전을 멈추고 그 방향 그대로, 나침반을 누르면 다시 진행 방향 위', () => {
    updateSettings({ mapView: 'heading' });
    const { container, rerender } = render(<DriveView {...props()} />);
    const map = container.querySelector('.drive-map .replay-map, .drive-map .live-map')!;
    fireEvent.touchStart(map, { touches: t(0) });
    fireEvent.touchMove(map, { touches: t(15) });
    fireEvent.touchMove(map, { touches: t(45) });
    fireEvent.touchEnd(map, { touches: [] });
    expect(compass()).toHaveAccessibleName('지도 보기: 손으로 돌림 (누르면 진행 방향 위)');
    fireEvent.click(compass());
    rerender(<DriveView {...props()} />);
    expect(getSettings().mapView).toBe('heading');
    expect(compass()).toHaveAccessibleName('지도 보기: 진행 방향 위 (누르면 전체 코스)');
    expect(onCycle).not.toHaveBeenCalled();
  });

  it('나를 가운데(북쪽 위)에서도 돌릴 수 있고, 나침반을 누르면 진행 방향 위로', () => {
    updateSettings({ mapView: 'follow' });
    const { container, rerender } = render(<DriveView {...props()} />);
    const map = container.querySelector('.drive-map .replay-map, .drive-map .live-map')!;
    fireEvent.touchStart(map, { touches: t(0) });
    fireEvent.touchMove(map, { touches: t(-40) });
    fireEvent.touchEnd(map, { touches: [] });
    expect(compass()).toHaveAccessibleName('지도 보기: 손으로 돌림 (누르면 진행 방향 위)');
    fireEvent.click(compass());
    rerender(<DriveView {...props()} />);
    expect(getSettings().mapView).toBe('heading');
  });

  it('전체 코스 보기에서는 돌리지 않는다', () => {
    updateSettings({ mapView: 'fit' });
    const { container } = render(<DriveView {...props()} />);
    const map = container.querySelector('.drive-map .replay-map, .drive-map .live-map')!;
    fireEvent.touchStart(map, { touches: t(0) });
    fireEvent.touchMove(map, { touches: t(45) });
    fireEvent.touchEnd(map, { touches: [] });
    expect(compass()).toHaveAccessibleName('지도 보기: 전체 코스 (누르면 나를 가운데)');
  });
});


// 지도 손 동작 메인·주행 똑같이 (사용자 요청·시안 2026-11-18): 한 손가락 끌기, 벗어나면 GPS 버튼이 "내 위치로",
// 누르거나 3초 손을 안 대면 내 위치·평소 주행 확대·나침반 보기대로 (둘러보며 바꾼 확대·방향은 잠깐만)
describe('주행 지도 끌어서 둘러보기', () => {
  const one = (x: number, y: number) => [{ clientX: x, clientY: y, identifier: 0 }];
  const mapEl = (c: HTMLElement) => c.querySelector('.drive-map .replay-map, .drive-map .live-map')!;
  const drag = (m: Element) => {
    fireEvent.touchStart(m, { touches: one(200, 400) });
    fireEvent.touchMove(m, { touches: one(230, 440) });
    fireEvent.touchMove(m, { touches: one(260, 480) });
    fireEvent.touchEnd(m, { touches: [] });
  };
  const gps = () => screen.getByRole('button', { name: /^내 위치로/ });

  it('오른쪽 위 GPS 아이콘은 누를 수 있는 버튼, 끌어서 벗어나면 "내 위치로"가 보이고 누르면 돌아온다', () => {
    updateSettings({ mapView: 'follow' });
    const { container } = render(<DriveView {...props()} />);
    expect(gps()).not.toHaveTextContent('내 위치로');
    drag(mapEl(container));
    expect(gps()).toHaveTextContent('내 위치로');
    fireEvent.click(gps());
    expect(gps()).not.toHaveTextContent('내 위치로');
    expect(onCycle).not.toHaveBeenCalled();
  });

  it('손을 떼고 3초 동안 안 대면 저절로 내 위치로, 그 전에 다시 대면 기다림을 새로', () => {
    vi.useFakeTimers();
    try {
      updateSettings({ mapView: 'heading' });
      const { container } = render(<DriveView {...props()} />);
      const m = mapEl(container);
      drag(m);
      act(() => vi.advanceTimersByTime(2500));
      expect(gps()).toHaveTextContent('내 위치로');
      drag(m);
      act(() => vi.advanceTimersByTime(2500));
      expect(gps()).toHaveTextContent('내 위치로');
      act(() => vi.advanceTimersByTime(600));
      expect(gps()).not.toHaveTextContent('내 위치로');
    } finally {
      vi.useRealTimers();
    }
  });

  it('둘러보며 바꾼 확대는 저장하지 않는다 (돌아오면 평소 주행 크기)', () => {
    updateSettings({ mapView: 'follow', driveZoom: 0.5 });
    const { container } = render(<DriveView {...props()} />);
    const m = mapEl(container);
    drag(m);
    const two = (d: number) => [
      { clientX: 100, clientY: 300, identifier: 0 },
      { clientX: 100 + d, clientY: 300, identifier: 1 },
    ];
    fireEvent.touchStart(m, { touches: two(100) });
    fireEvent.touchMove(m, { touches: two(200) });
    fireEvent.touchEnd(m, { touches: [] });
    expect(getSettings().driveZoom).toBe(0.5);
    fireEvent.click(screen.getByRole('button', { name: '지도 확대' }));
    expect(getSettings().driveZoom).toBe(0.5);
  });

  it('손으로 돌려 둔 방향도 GPS 버튼을 누르면 나침반 보기대로', () => {
    updateSettings({ mapView: 'heading' });
    const { container, rerender } = render(<DriveView {...props()} />);
    const m = mapEl(container);
    const t = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return [
        { clientX: 200 - Math.cos(a) * 60, clientY: 300 - Math.sin(a) * 60, identifier: 0 },
        { clientX: 200 + Math.cos(a) * 60, clientY: 300 + Math.sin(a) * 60, identifier: 1 },
      ];
    };
    fireEvent.touchStart(m, { touches: t(0) });
    fireEvent.touchMove(m, { touches: t(40) });
    fireEvent.touchEnd(m, { touches: [] });
    expect(screen.getByRole('button', { name: /^지도 보기/ })).toHaveAccessibleName('지도 보기: 손으로 돌림 (누르면 진행 방향 위)');
    fireEvent.click(gps());
    rerender(<DriveView {...props()} />);
    expect(screen.getByRole('button', { name: /^지도 보기/ })).toHaveAccessibleName('지도 보기: 진행 방향 위 (누르면 전체 코스)');
  });

  it('끌기 뒤에 바로 누른 것은 두 번 탭(화면 모드 바꾸기)으로 치지 않는다', () => {
    updateSettings({ mapView: 'follow' });
    const { container } = render(<DriveView {...props()} />);
    const root = container.querySelector('[data-testid="drive"]')!;
    fireEvent.pointerDown(root, { clientX: 200, clientY: 400 });
    fireEvent.pointerMove(root, { clientX: 260, clientY: 470 });
    fireEvent.pointerDown(root, { clientX: 205, clientY: 405 });
    expect(onCycle).not.toHaveBeenCalled();
  });

  it('전체 코스 보기에서는 끌어도 옮기지 않는다', () => {
    updateSettings({ mapView: 'fit' });
    const { container } = render(<DriveView {...props()} />);
    drag(mapEl(container));
    expect(gps()).not.toHaveTextContent('내 위치로');
  });
});
