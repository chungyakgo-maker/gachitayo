import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors } from '../generators';
import { processDrive } from '../../src/engine/process/processDrive';
import { courseToGpx, sessionToGpx } from '../../src/gpx/export';

vi.mock('../../src/app/drive', () => ({ loadCourses: vi.fn(async () => []), processSession: vi.fn(async () => null) }));

const { createMapCourse, importGpx, moveCourseGate, recomputeCourse, renameCourse, sectorMarks } = await import('../../src/app/courses');
const rec = await import('../../src/app/recording');
const drive = await import('../../src/app/drive');

const truth = simulateDrive(stadiumTrack(), { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });
const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 51 });
const r = processDrive({ gps: s.gps, motion: s.motion, events: [{ t: 0, type: 'start' }], course: null, newCourse: { id: crypto.randomUUID(), name: '오벌' } });

describe('코스 관리 (사양서 8.7, M10)', () => {
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
