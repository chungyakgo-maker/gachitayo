import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '../../src/types/course';

// 팀 방 코스 (설계 3부): 방장 폰의 코스 → 방에 보낼 모양, 받은 모양 → 팀원 폰의 코스 (있으면 그 코스, 없으면 새로)
vi.mock('../../src/app/drive', () => ({ loadCourses: vi.fn(async () => []) }));

const gate = (lat: number) => ({ lat, lon: 127.5, bearingDeg: 0, widthM: 30 });
const line = (n: number, from = 37.5): Array<[number, number]> => Array.from({ length: n }, (_, i) => [from + i * 0.00001, 127.5] as [number, number]);
const course = (p: Partial<Course> = {}): Course => ({
  id: 'c1',
  name: '북악 새벽 코스',
  kind: 'point_to_point',
  source: 'auto',
  origin: { lat: 37.5, lon: 127.5 },
  startGate: gate(37.5),
  finishGate: gate(37.50999),
  centerline: line(1000),
  lengthM: 1110,
  sectorBoundsM: null,
  version: 2,
  ...p,
});

async function fresh() {
  vi.resetModules();
  const { GachitayoDb } = await import('../../src/storage/db');
  const db = new GachitayoDb();
  await Promise.all(db.tables.map((t) => t.clear()));
  db.close();
  const rec = await import('../../src/app/recording');
  const team = await import('../../src/app/teamCourse');
  return { rec, team };
}

beforeEach(() => vi.restoreAllMocks());

describe('roomCourseBody (방장이 보내는 모양)', () => {
  it('줄인 선·게이트·열쇠: 기본 코스 b:, 받은 코스 s:, 내가 공개한 코스 s:공개 번호, 그 밖엔 null', async () => {
    const { team } = await fresh();
    const b = team.roomCourseBody(course());
    expect(b).toMatchObject({ name: '북악 새벽 코스', kind: 'point_to_point', lengthM: 1110, key: null, startGate: gate(37.5), finishGate: gate(37.50999), sectorBoundsM: null });
    // 곧은 선이라 끝점 둘만 남는다
    expect(b.line).toEqual([line(1000)[0], line(1000)[999]]);
    expect(team.roomCourseBody(course({ builtin: 'bukak' })).key).toBe('b:bukak');
    expect(team.roomCourseBody(course({ source: 'shared', shared: { id: 'p1', by: '바람' } })).key).toBe('s:p1');
    expect(team.roomCourseBody(course({ publishedId: 'p2' })).key).toBe('s:p2');
    // 지도로 만든 코스(선 없음)는 빈 선
    expect(team.roomCourseBody(course({ centerline: null, lengthM: null })).line).toEqual([]);
  });

  it('구불구불한 긴 코스도 3000점 안으로 맞춘다', async () => {
    const { team } = await fresh();
    const zig: Array<[number, number]> = Array.from({ length: 30_000 }, (_, i) => [37.5 + i * 0.00002, 127.5 + Math.sin(i / 3) * 0.0002]);
    expect(team.roomCourseBody(course({ centerline: zig, lengthM: 60_000 })).line.length).toBeLessThanOrEqual(3000);
  });

  it('100 km 넘는 코스는 보내기 전에 알린다', async () => {
    const { team } = await fresh();
    expect(() => team.roomCourseBody(course({ lengthM: 100_001 }))).toThrow('100 km 넘는 코스는 팀 방에 정할 수 없어요');
  });
});

describe('courseForRoom (팀원 폰에 잇기)', () => {
  it('같은 기본 코스·받은 공개 코스·같은 모양이 있으면 그 코스, 새로 담지 않는다', async () => {
    const { rec, team } = await fresh();
    const repo = rec.getDriveRepo();
    await repo.putCourse(course({ id: 'b1', builtin: 'bukak', startGate: gate(36), finishGate: gate(36.01) }));
    await repo.putCourse(course({ id: 's1', source: 'shared', shared: { id: 'p1', by: '바람' }, startGate: gate(35), finishGate: gate(35.01) }));
    await repo.putCourse(course({ id: 'mine' }));
    const body = team.roomCourseBody(course());
    expect((await team.courseForRoom({ ...body, key: 'b:bukak' })).id).toBe('b1');
    expect((await team.courseForRoom({ ...body, key: 's:p1' })).id).toBe('s1');
    expect((await team.courseForRoom(body)).id).toBe('mine');
    expect(await repo.listCourses()).toHaveLength(3);
  });

  it('없으면 "팀 방에서 받음" 새 코스 (선은 1 m 로 펴고 출발선을 원점으로)', async () => {
    const { rec, team } = await fresh();
    const c = await team.courseForRoom(team.roomCourseBody(course()));
    expect(c).toMatchObject({ name: '북악 새벽 코스', source: 'team', kind: 'point_to_point', lengthM: 1110, version: 1, origin: { lat: 37.5, lon: 127.5 } });
    expect(c.centerline!.length).toBeGreaterThan(1000);
    expect(c.builtin).toBeUndefined();
    expect(c.shared).toBeUndefined();
    expect((await rec.getDriveRepo().listCourses()).map((x) => x.id)).toEqual([c.id]);
    // 선 없는 코스는 선 없이
    const m = await team.courseForRoom({ ...team.roomCourseBody(course({ centerline: null, lengthM: null })), startGate: gate(30), finishGate: gate(30.01) });
    expect(m.centerline).toBeNull();
  });

  it('refreshTeamCourse: 출발 때 폰에서 다시 찾는다 — 고쳤으면 고친 판, 지웠으면 다시 담는다', async () => {
    const { rec, team } = await fresh();
    const repo = rec.getDriveRepo();
    const body = team.roomCourseBody(course());
    const got = await team.courseForRoom(body);
    await repo.putCourse({ ...got, name: '고친 이름', version: 2 });
    expect(await team.refreshTeamCourse(got, body)).toMatchObject({ id: got.id, name: '고친 이름', version: 2 });
    await repo.deleteCourse(got.id);
    const again = await team.refreshTeamCourse(got, body);
    expect(again.id).not.toBe(got.id);
    expect((await repo.listCourses()).map((c) => c.id)).toEqual([again.id]);
  });

  it('코스가 200개면 담지 않고 알린다', async () => {
    const { rec, team } = await fresh();
    const repo = rec.getDriveRepo();
    for (let i = 0; i < 200; i++) await repo.putCourse(course({ id: `f${i}`, centerline: null, startGate: gate(30 + i * 0.01), finishGate: gate(30.005 + i * 0.01) }));
    await expect(team.courseForRoom(team.roomCourseBody(course()))).rejects.toThrow('내 코스가 200개예요');
    expect(await repo.listCourses()).toHaveLength(200);
  }, 30_000);
});
