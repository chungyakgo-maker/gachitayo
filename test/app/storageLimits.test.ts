// 기록은 폰에만 1부 (설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md): 원본 최근 30개만, 내 코스 200개
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { GachitayoDb } from '../../src/storage/db';
import { createDriveRepo } from '../../src/storage/driveRepo';
import { createSessionRepo } from '../../src/storage/sessionRepo';
import type { Course } from '../../src/types/course';
import type { SessionRecord, SessionStatus } from '../../src/types/session';
import { MY_COURSE_LIMIT, RAW_KEEP } from '../../src/app/limits';
import { assertCourseRoom, myCourseCount, pruneOldRaw } from '../../src/app/storageLimits';

let db: GachitayoDb;
let n = 0;
beforeEach(() => {
  db = new GachitayoDb(`limits-${++n}`);
});

const device = { os: 'iOS', browser: 'Safari', userAgent: 'ua', standalone: true };
const session = (id: string, startedAt: number, status: SessionStatus = 'processed', extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  courseId: null,
  courseVersion: null,
  status,
  startedAt,
  endedAt: startedAt + 60_000,
  device,
  calibration: null,
  summary: null,
  ...extra,
});
const chunk = (sessionId: string) => ({ sessionId, seq: 0, gps: [], rawMotion: [], events: [] });
const course = (id: string, builtin?: string): Course => ({
  id,
  name: id,
  kind: 'loop',
  source: 'auto',
  origin: { lat: 37.2, lon: 127.1 },
  startGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  finishGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  centerline: null,
  lengthM: null,
  sectorBoundsM: null,
  version: 1,
  ...(builtin ? { builtin } : {}),
});

async function seed(list: SessionRecord[]): Promise<void> {
  const repo = createSessionRepo(db);
  for (const s of list) {
    await repo.create(s);
    await repo.putChunk(chunk(s.id));
  }
}

describe('원본 한도 (최근 30개 주행만)', () => {
  it('한도 값은 30, 내 코스는 200', () => {
    expect(RAW_KEEP).toBe(30);
    expect(MY_COURSE_LIMIT).toBe(200);
  });

  it('최근 30개만 원본 유지: 35개면 가장 오래된 5개의 원본을 지우고 rawPruned', async () => {
    await seed(Array.from({ length: 35 }, (_, i) => session(`s${i}`, 1_800_000_000_000 + i * 1000)));
    const repo = createSessionRepo(db);
    expect(await pruneOldRaw(repo)).toBe(5);
    for (let i = 0; i < 35; i++) {
      const s = (await repo.get(`s${i}`))!;
      const left = (await repo.chunks(`s${i}`)).length;
      if (i < 5) {
        expect(left).toBe(0);
        expect(s.rawPruned).toBe(true);
      } else {
        expect(left).toBe(1);
        expect(s.rawPruned).toBeFalsy();
      }
    }
  });

  it('recording·finished(계산 전)·noRecord·restoring 은 30개 밖이어도 원본 유지 (세지도 않음)', async () => {
    const old = 1_700_000_000_000;
    await seed([
      session('rec', old, 'recording'),
      session('fin', old + 1, 'finished'),
      session('nr', old + 2, 'processed', { noRecord: true }),
      session('rs', old + 3, 'processed', { restoring: true }),
      ...Array.from({ length: 30 }, (_, i) => session(`p${i}`, 1_800_000_000_000 + i, i % 2 ? 'uploaded' : 'processed')),
    ]);
    const repo = createSessionRepo(db);
    expect(await pruneOldRaw(repo)).toBe(0);
    for (const id of ['rec', 'fin', 'nr', 'rs']) expect((await repo.chunks(id)).length).toBe(1);
  });

  it('두 번 불러도 같은 결과 (두 번째는 0)', async () => {
    await seed(Array.from({ length: 32 }, (_, i) => session(`s${i}`, 1_800_000_000_000 + i)));
    const repo = createSessionRepo(db);
    expect(await pruneOldRaw(repo)).toBe(2);
    expect(await pruneOldRaw(repo)).toBe(0);
  });

  it('원본이 이미 없는 오래된 기록도 rawPruned 로 표시 (지운 수에는 안 셈)', async () => {
    const repo = createSessionRepo(db);
    await seed(Array.from({ length: 30 }, (_, i) => session(`s${i}`, 1_800_000_000_000 + i)));
    await repo.create(session('gone', 1_700_000_000_000));
    expect(await pruneOldRaw(repo)).toBe(0);
    expect((await repo.get('gone'))!.rawPruned).toBe(true);
  });
});

describe('내 코스 한도 (200개)', () => {
  it('기본 코스는 세지 않는다. 200개면 막고 199개면 통과', async () => {
    const drive = createDriveRepo(db);
    for (let i = 0; i < 10; i++) await drive.putCourse(course(`b${i}`, `key${i}`));
    for (let i = 0; i < 199; i++) await drive.putCourse(course(`m${i}`));
    expect(await myCourseCount(drive)).toBe(199);
    await expect(assertCourseRoom(drive)).resolves.toBeUndefined();
    await drive.putCourse(course('m199'));
    await expect(assertCourseRoom(drive)).rejects.toThrow('내 코스가 200개예요. 안 쓰는 코스를 지운 뒤 다시 해 주세요');
  }, 30_000);

  it('한꺼번에 여러 개 더할 때(adding)도 셈', async () => {
    const drive = createDriveRepo(db);
    for (let i = 0; i < 198; i++) await drive.putCourse(course(`m${i}`));
    await expect(assertCourseRoom(drive, 2)).resolves.toBeUndefined();
    await expect(assertCourseRoom(drive, 3)).rejects.toThrow('내 코스가 200개예요');
  }, 30_000);
});

describe('주행 뒤 코스 저장도 한도를 지킨다', () => {
  it('제안 코스 저장·벗어난 길 새 코스: 200개면 막는다', async () => {
    const { saveProposedCourse, saveDetourAsNew } = await import('../../src/app/sessionProcessing');
    const sessions = createSessionRepo(db);
    const drive = createDriveRepo(db);
    for (let i = 0; i < 200; i++) await drive.putCourse(course(`m${i}`));
    await sessions.create(session('s1', 1_800_000_000_000));
    await drive.putResult({ sessionId: 's1', courseId: null, proposedCourse: course('new'), detourCourse: course('det'), laps: [] } as never);
    const deps = { sessions, drive };
    await expect(saveProposedCourse(deps, 's1', '새')).rejects.toThrow('내 코스가 200개예요');
    await expect(saveDetourAsNew(deps, 's1', '새')).rejects.toThrow('내 코스가 200개예요');
    expect(await myCourseCount(drive)).toBe(200);
  }, 30_000);
});

describe('저장 공간 요약 (설정 시안 ①)', () => {
  it('기록 수·원본 남은 기록 수·대략 크기·내 코스 수·지금 정리할 수 있는 수', async () => {
    const { storageSummary } = await import('../../src/app/storageLimits');
    const repo = createSessionRepo(db);
    const drive = createDriveRepo(db);
    await seed(Array.from({ length: 33 }, (_, i) => session(`s${i}`, 1_800_000_000_000 + i)));
    await repo.create(session('nochunk', 1_900_000_000_000));
    await repo.create(session('rec', 1_900_000_000_001, 'recording'));
    await drive.putCourse(course('b1', 'key'));
    await drive.putCourse(course('m1'));
    const s = await storageSummary(repo, drive);
    expect(s).toMatchObject({ sessions: 34, rawSessions: 33, myCourses: 1, prunable: 4 });
    expect(s.rawBytes).toBeGreaterThan(0);
  });
});
