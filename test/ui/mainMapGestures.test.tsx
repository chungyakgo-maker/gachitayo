// 메인 지도 손 동작을 주행 지도와 똑같이 (사용자 요청·시안 2026-11-18): 두 손가락 비틀기로 돌리기, 돌렸을 때만 왼쪽 위 나침반(누르면 북쪽 위),
// 벗어나면 GPS 버튼이 "내 위치로", 누르면 내 위치·기본 확대·북쪽 위
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MainMapApi } from '../../src/ui/map/mapTypes';

const h = vi.hoisted(() => ({
  view: null as ((v: { away: boolean; bearing: number }) => void) | null,
  locate: vi.fn(),
  resetNorth: vi.fn(),
}));
vi.mock('../../src/ui/map/lineMapSupport', () => ({ lineMapConfig: async () => ({ tiles: '', glyphs: '', maxzoom: 14 }) }));
vi.mock('../../src/ui/map/lineMainMap', () => ({
  createLineMainMap: (): MainMapApi =>
    new Proxy(
      {
        onView: (cb: typeof h.view) => {
          h.view = cb;
        },
        locate: h.locate,
        resetNorth: h.resetNorth,
      } as unknown as MainMapApi,
      { get: (t, k) => (k in t ? (t as unknown as Record<string, unknown>)[k as string] : () => {}) },
    ),
}));

import { MainMap } from '../../src/ui/components/MainMap';

const me = { lat: 37.5, lon: 127, hAcc: 5 };

describe('메인 지도 손 동작', () => {
  it('벗어나면 GPS 버튼이 "내 위치로", 돌렸을 때만 나침반, 각각 누르면 내 위치 / 북쪽 위', async () => {
    render(<MainMap course={null} me={me} label="메인 지도" gps="good" gpsAcc={5} />);
    await waitFor(() => expect(h.view).not.toBeNull());
    const gps = () => screen.getByRole('button', { name: /^내 위치로/ });
    expect(gps()).not.toHaveTextContent('내 위치로');
    expect(screen.queryByRole('button', { name: /북쪽 위로/ })).toBeNull();

    act(() => h.view!({ away: true, bearing: 32 }));
    expect(gps()).toHaveTextContent('내 위치로');
    const north = screen.getByRole('button', { name: /북쪽 위로/ });
    fireEvent.click(north);
    expect(h.resetNorth).toHaveBeenCalled();
    fireEvent.click(gps());
    expect(h.locate).toHaveBeenCalledWith(me);

    act(() => h.view!({ away: false, bearing: 0 }));
    expect(gps()).not.toHaveTextContent('내 위치로');
    expect(screen.queryByRole('button', { name: /북쪽 위로/ })).toBeNull();
  });
});
