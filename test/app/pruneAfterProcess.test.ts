import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors } from '../generators';

// 기록은 폰에만 1부: 주행을 처리하면 원본 한도(최근 30개)를 지킨다 — 오래된 원본이 폰에 쌓이지 않게
const truth = simulateDrive(stadiumTrack(), { laps: 1, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });
const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 9 });
const device = { os: 'iOS', browser: 'Safari', userAgent: 'ua', standalone: true };

describe('처리 뒤 원본 정리', () => {
  it('새 주행을 처리하면 31번째로 오래된 기록의 원본을 지운다', async () => {
    const rec = await import('../../src/app/recording');
    const drive = await import('../../src/app/drive');
    const repo = rec.getRepo();
    const mk = async (id: string, startedAt: number, status: 'processed' | 'finished') => {
      await repo.create({ id, courseId: null, courseVersion: null, status, startedAt, endedAt: null, device, calibration: null, summary: null });
      await repo.putChunk({ sessionId: id, seq: 0, gps: status === 'finished' ? s.gps : [], rawMotion: status === 'finished' ? s.motion : [], events: [{ t: 0, type: 'start' }] });
    };
    await mk('oldest', 1_700_000_000_000, 'processed');
    for (let i = 0; i < 29; i++) await mk(`p${i}`, 1_800_000_000_000 + i, 'processed');
    await mk('new', 1_900_000_000_000, 'finished');
    expect(await drive.processSession('new')).not.toBeNull();
    for (let i = 0; i < 50 && (await repo.chunks('oldest')).length > 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect((await repo.chunks('oldest')).length).toBe(0);
    expect((await repo.get('oldest'))!.rawPruned).toBe(true);
    expect((await repo.chunks('new')).length).toBe(1);
  });
});
