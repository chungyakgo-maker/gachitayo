import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors } from '../generators';
import { processDrive } from '../../src/engine/process/processDrive';
import { courseToGpx, sessionToGpx } from '../../src/gpx/export';
import type { RefLapRecord } from '../../src/types/drive';

vi.mock('../../src/app/drive', () => ({ loadCourses: vi.fn(async () => []), processSession: vi.fn(async () => null) }));

const { createMapCourse, deleteCourse, importGpx, makeReverseCourse, moveCourseGate, recomputeCourse, renameCourse, sectorMarks, seedBuiltinCourses } = await import('../../src/app/courses');
const rec = await import('../../src/app/recording');
const drive = await import('../../src/app/drive');

const truth = simulateDrive(stadiumTrack(), { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });
const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 51 });
const r = processDrive({ gps: s.gps, motion: s.motion, events: [{ t: 0, type: 'start' }], course: null, newCourse: { id: crypto.randomUUID(), name: '오벌' } });

describe('코스 관리 (사양서 8.7, M10)', () => {
  it('기본 코스: 앱 시작 때 폰 목록에 다섯 코스를 한 번 넣는다 (폰마다 새 번호, 서버 대기열에는 넣지 않음)', async () => {
    await seedBuiltinCourses();
    const list = await rec.getDriveRepo().listCourses();
    const built = list.filter((c) => c.builtin);
    expect(built.map((c) => c.name).sort()).toEqual(['구룡령', '만항재', '말티재', '미시령 옛길', '배후령']);
    expect(built.every((c) => /^[0-9a-f-]{36}$/.test(c.id) && c.centerline && c.lengthM! > 2000)).toBe(true);
    expect((await rec.getQueueRepo().all()).filter((q) => built.some((c) => c.id === q.targetId))).toEqual([]);
    expect(drive.loadCourses).toHaveBeenCalled();
    await seedBuiltinCourses();
    expect((await rec.getDriveRepo().listCourses()).filter((c) => c.builtin)).toHaveLength(5);
  });

  it('역방향 코스: 내 코스로 만들고, 다시 누르면 있는 것을 돌려준다. 역방향의 역방향은 원래 코스', async () => {
    await seedBuiltinCourses();
    const drive = rec.getDriveRepo();
    const mh = (await drive.listCourses()).find((x) => x.builtin === 'manhangjae')!;
    const a = await makeReverseCourse(mh.id);
    expect(a.created).toBe(true);
    expect(a.course).toMatchObject({ name: '만항재 역방향', kind: 'point_to_point', version: 1 });
    expect(a.course.builtin).toBeUndefined();
    expect(await drive.getCourse(a.course.id)).toBeDefined();
    const again = await makeReverseCourse(mh.id);
    expect(again).toEqual({ course: expect.objectContaining({ id: a.course.id }), created: false });
    const back = await makeReverseCourse(a.course.id);
    expect(back.created).toBe(false);
    expect(back.course.id).toBe(mh.id);
  });

  it('코스 지우기: 이 코스로 달린 기록·비교 랩도 함께 지운다. 다른 코스 기록은 남는다. 기본 코스는 못 지운다', async () => {
    const drive = rec.getDriveRepo();
    const repo = rec.getRepo();
    const c = { ...r.course!, id: crypto.randomUUID(), name: '지울 코스' };
    const other = { ...r.course!, id: crypto.randomUUID(), name: '남길 코스' };
    await drive.putCourse(c);
    await drive.putCourse(other);
    const base = { courseVersion: 1, status: 'processed' as const, startedAt: 1, endedAt: 2, device: { os: 'x', browser: 'y', userAgent: 'z', standalone: false }, calibration: null, summary: null };
    const s1 = crypto.randomUUID();
    const s2 = crypto.randomUUID();
    const s3 = crypto.randomUUID();
    await repo.create({ id: s1, courseId: c.id, ...base });
    await repo.create({ id: s2, courseId: c.id, ...base });
    await repo.create({ id: s3, courseId: other.id, ...base });
    const ref = (sessionId: string, courseId: string): RefLapRecord => ({ id: `${sessionId}:1`, sessionId, courseId, courseVersion: 1, lapNo: 1, startedAt: 1, lapTimeMs: 60_000, sectorTimesMs: [1, 2, 3], trace: r.laps[0]!.trace });
    await drive.putRefLaps([ref(s1, c.id), ref(s3, other.id)]);
    expect(await deleteCourse(c.id)).toBe(2);
    expect(await drive.getCourse(c.id)).toBeUndefined();
    expect(await repo.get(s1)).toBeUndefined();
    expect(await repo.get(s2)).toBeUndefined();
    expect(await drive.refLaps(c.id, 1)).toEqual([]);
    expect(await repo.get(s3)).toBeDefined();
    expect(await drive.refLaps(other.id, 1)).toHaveLength(1);
    await expect(deleteCourse(c.id)).rejects.toThrow('찾을 수 없어요');
    await seedBuiltinCourses();
    const b = (await drive.listCourses()).find((x) => x.builtin === 'baehuryeong')!;
    await expect(deleteCourse(b.id)).rejects.toThrow('기본 코스는 지울 수 없어요');
  });

  it('이름 바꾸기는 저장하고 서버에 코스를 올리도록 대기열에 넣는다', async () => {
    const c = r.course!;
    await rec.getDriveRepo().putCourse(c);
    await renameCourse(c.id, '  인제 풀코스 ');
    expect((await rec.getDriveRepo().getCourse(c.id))!.name).toBe('인제 풀코스');
    await expect(renameCourse(c.id, '  ')).rejects.toThrow('이름');
  });

  it('출발선 옮기기: 버전 +1, 이 코스의 기록을 모두 다시 계산(원본이 없으면 건너뜀)', async () => {
    const c = r.course!;
    await rec.getDriveRepo().putCourse(c);
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const base = { courseId: c.id, courseVersion: 1, status: 'processed' as const, startedAt: 1, endedAt: 2, device: { os: 'x', browser: 'y', userAgent: 'z', standalone: false }, calibration: null, summary: null };
    await rec.getRepo().create({ id: id1, ...base });
    await rec.getRepo().putChunk({ sessionId: id1, seq: 0, gps: s.gps, rawMotion: [], events: [] });
    await rec.getRepo().create({ id: id2, ...base }); // 원본 정리됨, 서버도 없음
    const target = c.centerline![Math.floor(c.centerline!.length / 3)]!;
    const moved = await moveCourseGate(c.id, 'start', { lat: target[0], lon: target[1] });
    expect(moved.version).toBe(2);
    expect(Math.hypot(moved.startGate.lat - target[0], moved.startGate.lon - target[1])).toBeLessThan(0.0002);
    const res = await recomputeCourse(c.id);
    expect(res).toEqual({ done: 1, skipped: 1 });
    expect(drive.processSession).toHaveBeenCalledWith(id1);
  });

  it('지도에서 새 코스: 출발선 위치와 방향, 편도는 도착선도. 게이트 폭은 설정값, 중심선은 첫 주행 뒤', async () => {
    const at = { lat: 37.5, lon: 127 };
    const c = await createMapCourse({ name: '', kind: 'loop', start: { at, toward: { lat: 37.5, lon: 127.001 } } });
    expect(c).toMatchObject({ name: '새 코스', kind: 'loop', source: 'map', centerline: null, version: 1 });
    expect(c.startGate.bearingDeg).toBeCloseTo(90, 0);
    expect(c.startGate.widthM).toBe(30);
    await expect(createMapCourse({ name: 'x', kind: 'point_to_point', start: { at, toward: { lat: 37.501, lon: 127 } } })).rejects.toThrow('도착선');
    await expect(createMapCourse({ name: 'x', kind: 'loop', start: { at, toward: at } })).rejects.toThrow('진행 방향');
  });

  it('GPX 불러오기: 코스로 등록 또는 주행 기록으로 (GPS만, 처리까지)', async () => {
    const cgpx = courseToGpx(r.course!);
    const imp = await importGpx(cgpx, 'course', '불러온 코스');
    expect(imp.kind).toBe('course');
    const sgpx = sessionToGpx({ name: '주행', gps: s.gps.slice(0, 200).map((g) => ({ tFix: g.tFix, lat: g.lat, lon: g.lon, alt: g.alt, speed: g.speed })) });
    const imp2 = await importGpx(sgpx, 'session', '');
    expect(imp2.kind).toBe('session');
    const id = (imp2 as { sessionId: string }).sessionId;
    const chunks = await rec.getRepo().chunks(id);
    const { parseGpx } = await import('../../src/gpx/parse');
    const { gpsSamplesFromGpx } = await import('../../src/gpx/course');
    expect(chunks[0]!.gps.length).toBe(gpsSamplesFromGpx(parseGpx(sgpx)).length);
    expect(chunks[0]!.gps.length).toBeGreaterThan(100);
    expect(chunks[0]!.rawMotion).toEqual([]);
    expect(drive.processSession).toHaveBeenCalledWith(id);
  });

  it('구간 경계 표시 위치 두 곳', () => {
    const m = sectorMarks(r.course!);
    expect(m.map((x) => x.label)).toEqual(['1|2', '2|3']);
  });
});
