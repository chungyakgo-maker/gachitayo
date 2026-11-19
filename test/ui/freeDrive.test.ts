import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 일반 주행 (사용자 결정 "기록 안 남김"): 화면은 똑같이, 끝나면 기록을 지우고 메인으로
const discardRecording = vi.fn(async () => {});
const stopRecording = vi.fn(async () => 'sid');
const update = vi.fn(async () => {});
let recPhase = 'idle';
vi.mock('../../src/app/recording', async (orig) => ({
  ...(await orig<typeof import('../../src/app/recording')>()),
  startRecording: () => {
    recPhase = 'recording';
  },
  discardRecording: () => {
    recPhase = 'idle';
    return discardRecording();
  },
  stopRecording: () => stopRecording(),
  getRecordingState: () => ({ phase: recPhase, sessionId: 'sid', error: null }),
  subscribeSamples: () => () => {},
  markRecordingEvent: () => {},
  getRepo: () => ({ update, get: async () => undefined, list: async () => [] }),
}));
vi.mock('../../src/app/liveLink', async (orig) => ({ ...(await orig<typeof import('../../src/app/liveLink')>()), startLiveLinks: () => {}, stopLiveLinks: () => {} }));

describe('일반 주행 (기록 안 남김)', () => {
  beforeEach(() => {
    discardRecording.mockClear();
    stopRecording.mockClear();
    update.mockClear();
  });

  it('고르면 코스 없이 기록 안 남김으로 준비하고, 시작하면 세션에 표시, 끝나면 기록을 지우고 메인으로', async () => {
    const d = await import('../../src/app/drive');
    d.beginPrepare();
    d.chooseFreeDrive();
    expect(d.getDriveState()).toMatchObject({ phase: 'preparing', noRecord: true, course: null, courseChosen: true });
    d.startDrive();
    expect(update).toHaveBeenCalledWith('sid', expect.objectContaining({ noRecord: true }));
    await d.endDrive();
    expect(discardRecording).toHaveBeenCalledTimes(1);
    expect(stopRecording).not.toHaveBeenCalled();
    expect(d.getDriveState()).toMatchObject({ phase: 'idle', noRecord: false });
    expect(window.location.hash).toBe('#/');
  });

  it('다시 준비하면 기록하는 주행으로 돌아온다', async () => {
    const d = await import('../../src/app/drive');
    d.beginPrepare();
    expect(d.getDriveState().noRecord).toBe(false);
    await d.cancelPrepare();
  });
});

describe('바이크로 달린 주행 표시 (2026-11-18 바이크 모드: 요약에 최대 기울기)', () => {
  it('탈것이 바이크면 시작할 때 세션에 vehicle: bike, 자동차면 없음', async () => {
    const d = await import('../../src/app/drive');
    const { updateSettings, DEFAULT_SETTINGS } = await import('../../src/app/settings');
    for (const vehicle of ['bike', 'car'] as const) {
      update.mockClear();
      updateSettings({ vehicle });
      d.beginPrepare();
      d.chooseFreeDrive();
      d.startDrive();
      const patch = (update.mock.calls.at(-1) as unknown as [string, Record<string, unknown>])[1];
      if (vehicle === 'bike') expect(patch).toMatchObject({ vehicle: 'bike' });
      else expect(patch).not.toHaveProperty('vehicle');
      await d.endDrive();
    }
    updateSettings(DEFAULT_SETTINGS);
  });
});
