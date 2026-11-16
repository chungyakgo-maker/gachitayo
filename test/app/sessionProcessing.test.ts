import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, type DriveOpts, type Track } from '../generators';
import { courseFromTrack } from '../engine/course/helpers';
import { GachitayoDb } from '../../src/storage/db';
import { createSessionRepo } from '../../src/storage/sessionRepo';
import { createDriveRepo } from '../../src/storage/driveRepo';
import { changeProposedKind, dismissDetour, overwriteWithDetour, processStoredSession, saveDetourAsNew, saveProposedCourse, type ProcessDeps } from '../../src/app/sessionProcessing';

const oval = stadiumTrack();
const base: DriveOpts = { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };
const device = { os: 'Android 15', browser: 'Chrome 140', userAgent: 'ua', standalone: true };
let ids = 0;

async function storeSession(deps: ProcessDeps, id: string, opts: DriveOpts, seed: number, courseId: string | null = null, courseVersion: number | null = null, track: Track = oval) {
  const truth = simulateDrive(track, opts);
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

// 벗어난 길 저장 (설계 docs/superpowers/specs/2026-11-13-off-course-design.md): 랩 안에서 200 m 넘게 벗어나면 실제로 달린 길 코스를 만든다
describe('코스를 벗어난 길: 새 코스로 옮기기 · 지금 코스 덮어쓰기 · 안 함', () => {
  const db = new GachitayoDb('processing-detour');
  const deps: ProcessDeps = { sessions: createSessionRepo(db), drive: createDriveRepo(db), newId: () => `d${++ids}` };
  const wide = stadiumTrack(400, 120);
  const mine = { ...courseFromTrack(oval, { gateAtS: 100, id: 'my-oval' }), name: '내 오벌' };
  const builtin = { ...courseFromTrack(oval, { gateAtS: 100, id: 'b-oval' }), name: '기본 오벌', builtin: 'baehuryeong' };

  it('코스대로 달리면 벗어난 길이 없다', async () => {
    await deps.drive.putCourse(mine);
    await storeSession(deps, 'on', { ...base, laps: 2 }, 201, mine.id, mine.version);
    const r = await processStoredSession(deps, 'on');
    expect(r.offCourseM).toBeLessThan(200);
    expect(r.detourCourse ?? null).toBeNull();
  });

  it('반지름이 큰 길로 돌면 실제로 달린 길 코스를 제안한다 (이 주행은 아직 원래 코스)', async () => {
    await storeSession(deps, 'w1', { ...base, laps: 2 }, 202, mine.id, mine.version, wide);
    const r = await processStoredSession(deps, 'w1');
    expect(r.offCourseM).toBeGreaterThan(200);
    expect(r.courseId).toBe(mine.id);
    expect(r.detourCourse?.kind).toBe('loop');
    expect(r.detourCourse!.lengthM!).toBeGreaterThan(mine.lengthM! + 150);
  });

  it('새 코스로 저장하면 이 주행이 새 코스로 옮겨 가고, 원래 코스 비교 랩에서 빠진다', async () => {
    const { result, course } = await saveDetourAsNew(deps, 'w1', ' 큰 오벌 ');
    expect(course.name).toBe('큰 오벌');
    expect(course.id).not.toBe(mine.id);
    expect(result.courseId).toBe(course.id);
    expect(result.detourCourse ?? null).toBeNull();
    expect(result.laps.some((l) => l.valid)).toBe(true);
    expect((await deps.sessions.get('w1'))!.courseId).toBe(course.id);
    expect((await deps.drive.refLaps(mine.id, mine.version)).some((l) => l.sessionId === 'w1')).toBe(false);
    expect((await deps.drive.refLaps(course.id, 1)).some((l) => l.sessionId === 'w1')).toBe(true);
  });

  it('내 코스는 덮어쓸 수 있다: 이름·id는 그대로, 선은 달린 길로, 버전 +1, 이 주행은 바뀐 코스로', async () => {
    await storeSession(deps, 'w2', { ...base, laps: 2 }, 203, mine.id, mine.version, wide);
    await processStoredSession(deps, 'w2');
    const { result, course } = await overwriteWithDetour(deps, 'w2');
    expect(course).toMatchObject({ id: mine.id, name: '내 오벌', version: mine.version + 1 });
    expect(course.lengthM!).toBeGreaterThan(mine.lengthM! + 150);
    expect(result).toMatchObject({ courseId: mine.id, courseVersion: mine.version + 1 });
    expect(result.laps.some((l) => l.valid)).toBe(true);
  });

  it('기본 코스는 덮어쓸 수 없다', async () => {
    await deps.drive.putCourse(builtin);
    await storeSession(deps, 'w3', { ...base, laps: 2 }, 204, builtin.id, builtin.version, wide);
    expect((await processStoredSession(deps, 'w3')).detourCourse).not.toBeNull();
    await expect(overwriteWithDetour(deps, 'w3')).rejects.toThrow('기본 코스는 덮어쓸 수 없어요');
    expect((await deps.drive.getCourse(builtin.id))!.version).toBe(builtin.version);
  });

  it('안 함을 누르면 제안을 지운다', async () => {
    const r = await dismissDetour(deps, 'w3');
    expect(r.detourCourse).toBeNull();
    expect((await deps.drive.getResult('w3'))!.detourCourse).toBeNull();
  });
});
