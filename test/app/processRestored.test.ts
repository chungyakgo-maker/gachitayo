import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors } from '../generators';

// 되살린 기록 다시 계산 (카카오 로그인 5.7): 결과는 만들고, 서버에 이미 있으니 업로드 대기열에는 넣지 않는다
afterEach(() => vi.unstubAllEnvs());
const truth = simulateDrive(stadiumTrack(), { laps: 2, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });
const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 7 });

describe('processRestoredSession', () => {
  it('결과를 만들고 업로드 대기열에 넣지 않는다', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.workers.dev');
    vi.resetModules();
    const rec = await import('../../src/app/recording');
    const drive = await import('../../src/app/drive');
    const id = crypto.randomUUID();
    await rec.getRepo().create({ id, courseId: null, courseVersion: null, status: 'finished', startedAt: 1_800_000_000_000, endedAt: null, device: { os: 'iOS', browser: 'Safari', userAgent: 'ua', standalone: true }, calibration: null, summary: null });
    await rec.getRepo().putChunk({ sessionId: id, seq: 0, gps: s.gps, rawMotion: s.motion, events: [{ t: 0, type: 'start' }] });
    const r = await drive.processRestoredSession(id);
    expect(r?.sessionId).toBe(id);
    await new Promise((res) => setTimeout(res, 30));
    expect((await rec.getQueueRepo().all()).some((q) => q.targetId === id)).toBe(false);
  });
});
