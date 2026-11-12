import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

describe('기록 지우기: 폰 저장소와 대기열 (M10)', () => {
  it('세션·덩어리·결과·비교 랩을 지우고, 올리기 대기는 빼고 서버 지우기를 넣는다', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.workers.dev');
    vi.resetModules();
    const rec = await import('../../src/app/recording');
    const sync = await import('../../src/app/sync');
    const id = crypto.randomUUID();
    const repo = rec.getRepo();
    const drive = rec.getDriveRepo();
    const q = rec.getQueueRepo();
    await repo.create({ id, courseId: 'c1', courseVersion: 1, status: 'processed', startedAt: 1, endedAt: 2, device: { os: 'x', browser: 'y', userAgent: 'z', standalone: false }, calibration: null, summary: null });
    await repo.putChunk({ sessionId: id, seq: 0, gps: [], rawMotion: [], events: [] });
    await drive.putRefLaps([{ id: `${id}:1`, courseId: 'c1', courseVersion: 1, sessionId: id, lapNo: 1, startedAt: 1, lapTimeMs: 60_000, sectorTimesMs: [1, 2, 3], trace: { stepM: 5, t: [0], v: [0], alt: [null] } }]);
    await q.enqueue('session', id, 0);
    await sync.deleteSessionRecord(id);
    expect(await repo.get(id)).toBeUndefined();
    expect(await repo.chunks(id)).toEqual([]);
    expect(await drive.refLaps('c1', 1)).toEqual([]);
    const items = await q.all();
    expect(items.map((i) => i.id)).toEqual([`session-delete:${id}`]);
  });
});
