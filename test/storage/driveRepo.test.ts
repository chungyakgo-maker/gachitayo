import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { GachitayoDb } from '../../src/storage/db';
import { createDriveRepo } from '../../src/storage/driveRepo';
import { createSessionRepo } from '../../src/storage/sessionRepo';
import type { RefLapRecord } from '../../src/types/drive';
import type { Course } from '../../src/types/course';
import type { SessionRecord } from '../../src/types/session';

let n = 0;
const device = { os: 'Android 15', browser: 'Chrome 140', userAgent: 'ua', standalone: true };
const session = (id: string, startedAt = 1_800_000_000_000): SessionRecord => ({
  id,
  courseId: null,
  courseVersion: null,
  status: 'finished',
  startedAt,
  endedAt: startedAt + 60_000,
  device,
  calibration: null,
  summary: null,
});
const course = (id: string, version = 1): Course => ({
  id,
  name: '테스트',
  kind: 'loop',
  source: 'auto',
  origin: { lat: 37.2, lon: 127.1 },
  startGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  finishGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  centerline: [
    [37.2, 127.1],
    [37.201, 127.1],
  ],
  lengthM: 111,
  sectorBoundsM: [37, 74],
  version,
});
const ref = (sessionId: string, lapNo: number, lapTimeMs: number, courseId = 'c1', courseVersion = 1): RefLapRecord => ({
  id: `${sessionId}:${lapNo}`,
  courseId,
  courseVersion,
  sessionId,
  lapNo,
  startedAt: 1_800_000_000_000,
  lapTimeMs,
  sectorTimesMs: [1, 2, 3],
  trace: { stepM: 5, t: [0], v: [0], alt: [null] },
});

describe('폰 저장소 v2 (사양서 6.4)', () => {
  it('v1에서 올려도 기존 세션·덩어리가 남는다', async () => {
    const name = `drive-${++n}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ sessions: 'id, status, startedAt', chunks: '[sessionId+seq], sessionId' });
    await v1.table('sessions').add(session('old'));
    await v1.table('chunks').add({ sessionId: 'old', seq: 0, gps: [], rawMotion: [], events: [] });
    v1.close();
    const db = new GachitayoDb(name);
    expect(await createSessionRepo(db).get('old')).toBeTruthy();
    expect(await createSessionRepo(db).chunks('old')).toHaveLength(1);
    expect(await createDriveRepo(db).listCourses()).toEqual([]);
  });

  it('코스 저장·목록, 비교 랩은 코스·버전별로 빠른 순', async () => {
    const r = createDriveRepo(new GachitayoDb(`drive-${++n}`));
    await r.putCourse(course('c1'));
    await r.putCourse(course('c2'));
    expect((await r.listCourses()).map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    await r.putRefLaps([ref('s1', 1, 70_000), ref('s1', 2, 65_000), ref('s2', 1, 66_000), ref('s3', 1, 60_000, 'c1', 2), ref('s4', 1, 50_000, 'c2')]);
    const laps = await r.refLaps('c1', 1);
    expect(laps.map((l) => l.lapTimeMs)).toEqual([65_000, 66_000, 70_000]);
    expect((await r.bestRefLap('c1', 1))!.id).toBe('s1:2');
    expect(await r.bestRefLap('c9', 1)).toBeNull();
  });

  it('세션을 지우면 덩어리·결과·비교 랩도 지운다 (주행 준비 취소)', async () => {
    const db = new GachitayoDb(`drive-${++n}`);
    const sessions = createSessionRepo(db);
    const r = createDriveRepo(db);
    await sessions.create(session('s1'));
    await sessions.putChunk({ sessionId: 's1', seq: 0, gps: [], rawMotion: [], events: [] });
    await r.putRefLaps([ref('s1', 1, 70_000)]);
    await r.deleteSession('s1');
    expect(await sessions.get('s1')).toBeUndefined();
    expect(await sessions.chunks('s1')).toEqual([]);
    expect(await r.refLaps('c1', 1)).toEqual([]);
  });
});
