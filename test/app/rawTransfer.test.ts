import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors } from '../generators';
import { processDrive } from '../../src/engine/process/processDrive';

vi.mock('../../src/app/drive', () => ({ processSession: vi.fn(async () => null), loadCourses: vi.fn(async () => []) }));
afterEach(() => vi.unstubAllEnvs());

const truth = simulateDrive(stadiumTrack(), { laps: 2, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });
const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 61 });
const r = processDrive({ gps: s.gps, motion: s.motion, events: [{ t: 0, type: 'start' }], course: null, newCourse: { id: crypto.randomUUID(), name: '오벌' } });

describe('PC에서 내 기록 보기 (질문 6 결정 가): 원본 파일(+코스) 내보내기 → 가져오기', () => {
  it('폰에서 내보낸 원본을 다른 기기에서 가져오면 같은 코스로 계산하고, 그 기기에만 둔다(올리지 않음)', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.workers.dev');
    vi.resetModules();
    const rec = await import('../../src/app/recording');
    const { prepareRawExport, importRawFile } = await import('../../src/app/rawTransfer');
    const drive = await import('../../src/app/drive');
    const sync = await import('../../src/app/sync');
    const course = { ...r.course!, name: '연습 오벌' };
    const id = crypto.randomUUID();
    await rec.getDriveRepo().putCourse(course);
    await rec.getRepo().create({ id, courseId: course.id, courseVersion: course.version, status: 'processed', startedAt: 1_800_000_000_000, endedAt: null, device: { os: 'iOS 26', browser: 'Safari', userAgent: 'ua', standalone: true }, calibration: null, summary: null });
    await rec.getRepo().putChunk({ sessionId: id, seq: 0, gps: s.gps, rawMotion: s.motion, events: [{ t: 0, type: 'start' }] });
    const file = await prepareRawExport(id);
    expect(file.name).toMatch(/\.raw\.json\.gz$/);

    // "다른 기기": 같은 저장소라 이미 있는 id → 새 id로 가져온다
    const newId = await importRawFile(file);
    expect(newId).not.toBe(id);
    const got = (await rec.getRepo().get(newId))!;
    expect(got).toMatchObject({ imported: true, courseId: course.id, courseVersion: course.version, startedAt: 1_800_000_000_000 });
    const chunks = await rec.getRepo().chunks(newId);
    expect(chunks[0]!.gps.length).toBe(s.gps.length);
    expect(chunks[0]!.rawMotion.length).toBe(s.motion.length);
    expect(drive.processSession).toHaveBeenCalledWith(newId);
    // 올리기 대기열에 넣지 않는다
    await sync.enqueueSessionUpload(newId);
    expect((await rec.getQueueRepo().all()).some((q) => q.targetId === newId)).toBe(false);
  });

  it('원본이 아닌 파일은 알기 쉬운 말로 거부', async () => {
    vi.resetModules();
    const { importRawFile } = await import('../../src/app/rawTransfer');
    await expect(importRawFile(new File(['hello'], 'x.json'))).rejects.toThrow('원본 파일을 읽지 못했어요');
    await expect(importRawFile(new File([JSON.stringify({ formatVersion: 9 })], 'x.json'))).rejects.toThrow('지원하지 않는');
  });
});
