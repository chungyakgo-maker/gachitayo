// 주행 지도 확대·축소 (사용자 요청 "주행 모드중 지도 축소나 확대 할수 있게"): 오른쪽 + / −, 단계는 남고, 두 번 탭(모드 바꾸기)으로 치지 않는다.
// 2026-11-17 "부드럽게 확대·축소가 안 되고 뚝뚝 끊겨", "손으로 지도 회전이 안 돼": 두 손가락은 손가락을 따라 연속으로, 비틀면 지도가 돈다
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

