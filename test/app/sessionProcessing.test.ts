import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, type DriveOpts } from '../generators';
import { GachitayoDb } from '../../src/storage/db';
import { createSessionRepo } from '../../src/storage/sessionRepo';
import { createDriveRepo } from '../../src/storage/driveRepo';
import { changeProposedKind, processStoredSession, saveProposedCourse, type ProcessDeps } from '../../src/app/sessionProcessing';

const oval = stadiumTrack();
const base: DriveOpts = { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };
const device = { os: 'Android 15', browser: 'Chrome 140', userAgent: 'ua', standalone: true };
let ids = 0;

async function storeSession(deps: ProcessDeps, id: string, opts: DriveOpts, seed: number, courseId: string | null = null, courseVersion: number | null = null) {
  const truth = simulateDrive(oval, opts);
  const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed });
  await deps.sessions.create({ id, courseId, courseVersion, status: 'finished', startedAt: 1_800_000_000_000 + seed, endedAt: null, device, calibration: null, summary: null });
  // 5초 덩어리처럼 나눠 저장
  for (let seq = 0, t = 0; t <= truth.t.at(-1)! * 1000; seq++, t += 5000) {
    await deps.sessions.putChunk({
      sessionId: id,
      seq,
      gps: s.gps.filter((g) => g.tRecv >= t && g.tRecv < t + 5000),
      rawMotion: s.motion.filter((m) => m.t >= t && m.t < t + 5000),
      events: seq === 0 ? [{ t: 0, type: 'start' }] : [],
    });
  }
}

describe('주행 끝난 뒤 처리와 저장 (사양서 5.4, 8.5)', () => {
  const db = new GachitayoDb('processing-1');
  const deps: ProcessDeps = { sessions: createSessionRepo(db), drive: createDriveRepo(db), newId: () => `id${++ids}` };

  it('첫 주행: 코스를 제안만 하고(저장 전) 랩 결과를 남긴다', async () => {
    await storeSession(deps, 's1', base, 101);
    const r = await processStoredSession(deps, 's1');
    expect(r.proposedCourse?.kind).toBe('loop');
    expect(r.courseId).toBeNull();
    expect(r.laps.length).toBeGreaterThanOrEqual(2);
    expect(r.bestLapNo).not.toBeNull();
    const s = await deps.sessions.get('s1');
    expect(s!.status).toBe('processed');
    expect(s!.courseId).toBeNull();
    expect(s!.summary).toMatchObject({ courseName: null, lapCount: r.laps.length });
    expect(await deps.drive.listCourses()).toEqual([]);
  });

  it('종료 화면에서 편도로 바꾸면 편도로 다시 만든다', async () => {
    const r = await changeProposedKind(deps, 's1', 'point_to_point');
    expect(r.proposedCourse?.kind).toBe('point_to_point');
    const back = await changeProposedKind(deps, 's1', 'loop');
    expect(back.proposedCourse?.kind).toBe('loop');
  });

  it('이름을 넣어 저장하면 코스·비교 랩이 생기고 세션이 그 코스를 가리킨다', async () => {
    const { result, course } = await saveProposedCourse(deps, 's1', '  우리 동네 오벌 ');
    expect(course.name).toBe('우리 동네 오벌');
    expect(result.courseId).toBe(course.id);
    expect(result.proposedCourse).toBeNull();
    const refs = await deps.drive.refLaps(course.id, course.version);
    expect(refs.length).toBe(result.laps.filter((l) => l.valid).length);
    expect((await deps.sessions.get('s1'))!.summary!.courseName).toBe('우리 동네 오벌');
  });

  it('두 번째 주행(그 코스): 이전 베스트와 비교하고 비교 랩을 더한다', async () => {
    const course = (await deps.drive.listCourses())[0]!;
    const before = await deps.drive.bestRefLap(course.id, course.version);
    await storeSession(deps, 's2', { ...base, vMax: 41, aLatMax: 8.4 }, 102, course.id, course.version);
    const r = await processStoredSession(deps, 's2');
    expect(r.proposedCourse).toBeNull();
    expect(r.courseId).toBe(course.id);
    expect(r.previousBestMs).toBe(before!.lapTimeMs);
    const refs = await deps.drive.refLaps(course.id, course.version);
    expect(refs.some((l) => l.sessionId === 's2')).toBe(true);
    // 같은 세션을 다시 처리해도 이전 베스트는 이 세션을 빼고 계산한다
    expect((await processStoredSession(deps, 's2')).previousBestMs).toBe(before!.lapTimeMs);
  });

  it('GPS가 없는 기록은 알기 쉬운 오류', async () => {
    await deps.sessions.create({ id: 'empty', courseId: null, courseVersion: null, status: 'finished', startedAt: 1, endedAt: 2, device, calibration: null, summary: null });
    await expect(processStoredSession(deps, 'empty')).rejects.toThrow(/GPS/);
  });
});
