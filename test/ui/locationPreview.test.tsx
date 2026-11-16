// 위치 미리 보기: 메인은 이미 허용됐을 때만, 목적지 화면은 허용 전이어도 켠다 (아이폰은 허용해도 "prompt"로 알려 주는 경우가 많다)
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

let state = 'prompt';
const startGps = vi.fn(() => () => {});
vi.mock('../../src/sensors/permissions', () => ({ queryLocationPermission: async () => state }));
vi.mock('../../src/sensors/gps', () => ({ startGps: (...a: unknown[]) => startGps(...(a as [])) }));
const { useLocationPreview } = await import('../../src/ui/hooks/useLocationPreview');

beforeEach(() => startGps.mockClear());

describe('useLocationPreview', () => {
  it('main screen waits for a granted permission', async () => {
    state = 'prompt';
    const { result } = renderHook(() => useLocationPreview(true));
    await waitFor(() => expect(result.current.permission).toBe('prompt'));
    expect(startGps).not.toHaveBeenCalled();
  });

  it('request mode starts location when not yet granted', async () => {
    state = 'prompt';
    renderHook(() => useLocationPreview(true, true));
    await waitFor(() => expect(startGps).toHaveBeenCalledTimes(1));
  });

  it('request mode respects a denied permission', async () => {
    state = 'denied';
    const { result } = renderHook(() => useLocationPreview(true, true));
    await waitFor(() => expect(result.current.permission).toBe('denied'));
    expect(startGps).not.toHaveBeenCalled();
  });
});
