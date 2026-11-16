// 주행 지도 확대·축소 (사용자 요청 "주행 모드중 지도 축소나 확대 할수 있게"): 오른쪽 + / −, 단계는 남고, 두 번 탭(모드 바꾸기)으로 치지 않는다
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
  updateSettings({ driveZoom: 0 });
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

  it('only on the map screen', () => {
    render(<DriveView {...props()} mode="minimal" />);
    expect(screen.queryByRole('button', { name: '지도 확대' })).toBeNull();
  });
});
