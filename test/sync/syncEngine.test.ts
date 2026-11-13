import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { GachitayoDb } from '../../src/storage/db';
import { createSessionRepo } from '../../src/storage/sessionRepo';
import { createDriveRepo } from '../../src/storage/driveRepo';
import { createQueueRepo } from '../../src/storage/queueRepo';
import { syncOnce, cleanupUploaded, backoffMs, type Remote, type SyncDeps } from '../../src/sync/syncEngine';
import { courseRow, lapRows, sessionRow } from '../../src/sync/rows';
import { gunzipJson } from '../../src/storage/gzip';
import type { DriveResultRecord } from '../../src/types/drive';
import type { Course } from '../../src/types/course';
import type { DriveLap } from '../../src/engine/process/processDrive';

const USER = '11111111-1111-4111-8111-111111111111';
const SID = '33333333-3333-4333-8333-333333333333';
const CID = '44444444-4444-4444-8444-444444444444';
const device = { os: 'Android 15', browser: 'Chrome', userAgent: 'ua', standalone: true };
const lap = (lapNo: number, ms: number, valid = true): DriveLap => ({
  lapNo,
  startT: 0,
  endT: ms,
  lapTimeMs: ms + 0.4,
  sectorTimesMs: [1000.2, 2000.7, null],
  valid,
  invalidReason: valid ? null : 'gps_lost',
  maxSpeed: 40.1234,
  distanceM: 1000,
  trace: { stepM: 5, t: [0, 1], v: [1, 2], alt: [null, null] },
});
const course: Course = {
  id: CID,
  name: '오벌',
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
  version: 2,
};
const result = (laps: DriveLap[]): DriveResultRecord => ({
  sessionId: SID,
  courseId: CID,
  courseVersion: 2,
  processedAt: 0,
  laps,
  theoreticalBest: { sectorsMs: null, totalMs: null },
  bestLapNo: 1,
  processed: { hz: 10, n: 1, t: [0], lat: [37.2], lon: [127.1], alt: [null], speed: [0], heading: [0], ax: [null], ay: [null], s: [null], lapNo: [0] },
  fusion: { gpsOnly: false, speedQualityLow: false, axisSigns: { accel: 1, gyro: 1, confidence: 'high' } },
  proposedCourse: null,
  previousBestMs: null,
});

let n = 0;
async function setup(remoteOverride: Partial<Remote> = {}) {
  const db = new GachitayoDb(`sync-${++n}`);
  const sessions = createSessionRepo(db);
  const drive = createDriveRepo(db);
  const queue = createQueueRepo(db);
  const files = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const rows = { courses: [] as unknown[], sessions: [] as unknown[], laps: [] as unknown[], replaced: [] as Array<[string, number]> };
  const remote: Remote = {
    userId: async () => USER,
    token: async () => 'tok',
    upsertCourse: async (r) => {
      calls.push('course');
      rows.courses.push(r);
    },
    upsertSession: async (r) => {
      calls.push('session');
      rows.sessions.push(r);
    },
    replaceLaps: async (sid, r) => {
      calls.push('laps');
      rows.laps.push(...r);
      rows.replaced.push([sid, r.length]);
    },
    putFile: async (key, bytes) => {
      calls.push(`put ${key.split('.').at(-3)}`);
      files.set(key, bytes);
    },
    headFile: async (key) => files.get(key)?.byteLength ?? null,
    deleteSession: async (sid) => {
      calls.push(`delete ${sid}`);
    },
    deleteCourse: async (cid) => {
      calls.push(`delete course ${cid}`);
    },
    ...remoteOverride,
  };
  let now = 1_800_000_000_000;
  const deps: SyncDeps = { sessions, drive, queue, remote, now: () => now };
  await sessions.create({ id: SID, courseId: CID, courseVersion: 2, status: 'processed', startedAt: now - 3_600_000, endedAt: now - 3_000_000, device, calibration: null, summary: null });
  await sessions.putChunk({ sessionId: SID, seq: 0, gps: [{ tRecv: 1000, tFix: 1, lat: 37.2, lon: 127.1, alt: null, altAcc: null, hAcc: 5, speed: 0, heading: null }], rawMotion: [], events: [{ t: 0, type: 'start' }] });
  await drive.putCourse(course);
  await drive.putResult(result([lap(1, 60_000), lap(2, 61_000, false)]));
  return { deps, sessions, drive, queue, files, calls, rows, advance: (ms: number) => (now += ms), getNow: () => now };
}

describe('업로드 (사양서 5.4-4, 6.6, 9장)', () => {
  it('순서: 코스 → 원본·처리된 궤적 파일(확인) → 세션 행 → 랩 행. 끝나면 업로드됨, 대기열 비움', async () => {
    const s = await setup();
    await s.queue.enqueue('session', SID, s.getNow());
    const r = await syncOnce(s.deps);
    expect(r).toMatchObject({ done: 1, failed: 0 });
    expect(s.calls).toEqual(['course', 'put raw', 'put processed', 'session', 'laps']);
    expect([...s.files.keys()].sort()).toEqual([`${USER}/${SID}.processed.json.gz`, `${USER}/${SID}.raw.json.gz`]);
    const raw = (await gunzipJson(s.files.get(`${USER}/${SID}.raw.json.gz`)! as Uint8Array<ArrayBuffer>)) as { sessionId: string; gps: { lat: number[] } };
    expect(raw.sessionId).toBe(SID);
    expect(raw.gps.lat).toEqual([37.2]);
    expect(s.rows.sessions[0]).toMatchObject({ id: SID, course_id: CID, raw_key: `${USER}/${SID}.raw.json.gz`, processed_key: `${USER}/${SID}.processed.json.gz` });
    expect(s.rows.replaced).toEqual([[SID, 2]]);
    expect(await s.queue.count()).toBe(0);
    const sess = await s.sessions.get(SID);
    expect(sess!.status).toBe('uploaded');
    expect(sess!.uploadedAt).toBe(s.getNow());
  });

  it('실패하면 대기열에 남기고 지수 백오프로 다시 시도, 마지막 오류를 기록', async () => {
    let fail = true;
    const s = await setup({
      putFile: async () => {
        if (fail) throw new Error('파일 게이트웨이 503');
      },
    });
    await s.queue.enqueue('session', SID, s.getNow());
    const r1 = await syncOnce(s.deps);
    expect(r1).toMatchObject({ done: 0, failed: 1, lastError: '파일 게이트웨이 503' });
    const item = (await s.queue.all())[0]!;
    expect(item.attempts).toBe(1);
    expect(item.nextAt).toBe(s.getNow() + backoffMs(1));
    // 아직 때가 아니면 건너뛴다. 파일이 올라가기 전에는 표에 넣지 않는다
    expect((await syncOnce(s.deps)).done).toBe(0);
    expect(s.rows.sessions).toEqual([]);
    fail = false;
    s.advance(backoffMs(1));
    s.deps.remote.putFile = async (key, bytes) => {
      s.files.set(key, bytes);
    };
    expect((await syncOnce(s.deps)).done).toBe(1);
  });

  it('기록 지우기(M10): 대기열의 지우기 항목은 서버에 지우기를 보내고, 실패하면 다시 시도한다', async () => {
    const s = await setup({
      deleteSession: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await s.queue.enqueue('session-delete', SID, s.getNow());
    let r = await syncOnce(s.deps);
    expect(r).toMatchObject({ done: 0, failed: 1 });
    expect((await s.queue.all())[0]).toMatchObject({ kind: 'session-delete', attempts: 1 });
    s.deps.remote.deleteSession = async (sid) => {
      s.calls.push(`delete ${sid}`);
    };
    s.advance(10_000);
    r = await syncOnce(s.deps);
    expect(r).toMatchObject({ done: 1, failed: 0 });
    expect(s.calls).toEqual([`delete ${SID}`]);
    expect(await s.queue.count()).toBe(0);
  });

  it('지우기가 403(다른 계정의 것)이면 다시 시도하지 않고 대기열에서 뺀다 (카카오 로그인 검토)', async () => {
    const s = await setup({
      deleteSession: async () => {
        throw Object.assign(new Error('기록 지우기 실패 (403 다른 사람의 세션)'), { status: 403 });
      },
    });
    await s.queue.enqueue('session-delete', SID, s.getNow());
    expect(await syncOnce(s.deps)).toMatchObject({ done: 1, failed: 0 });
    expect(await s.queue.count()).toBe(0);
  });

  it('코스 지우기: 그 코스의 기록 지우기 뒤에 서버 코스 행을 지운다 (넣은 순서)', async () => {
    const s = await setup();
    const CID = '0b0b0b0b-0000-4000-8000-000000000001';
    await s.queue.enqueue('session-delete', SID, s.getNow());
    await s.queue.enqueue('course-delete', CID, s.getNow() + 1);
    s.advance(10);
    expect(await syncOnce(s.deps)).toMatchObject({ done: 2, failed: 0 });
    expect(s.calls).toEqual([`delete ${SID}`, `delete course ${CID}`]);
  });

  it('백오프: 10초부터 두 배씩, 최대 30분', () => {
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(2)).toBe(20_000);
    expect(backoffMs(20)).toBe(30 * 60_000);
  });

  it('올린 파일 크기가 다르면 실패로 보고 표에 넣지 않는다', async () => {
    const s = await setup({ headFile: async () => 1 });
    await s.queue.enqueue('session', SID, s.getNow());
    expect((await syncOnce(s.deps)).failed).toBe(1);
    expect(s.rows.sessions).toEqual([]);
  });

  it('계정이 없으면(서버 설정 전, 계정 만들기 전) 아무것도 하지 않는다', async () => {
    const s = await setup({ userId: async () => null });
    await s.queue.enqueue('session', SID, s.getNow());
    expect(await syncOnce(s.deps)).toMatchObject({ done: 0, failed: 0 });
    expect(await s.queue.count()).toBe(1);
  });

  it('같은 세션을 다시 대기열에 넣으면 하나만 (id 기준), 시도 횟수는 처음부터', async () => {
    const s = await setup();
    await s.queue.enqueue('session', SID, s.getNow());
    await s.queue.enqueue('session', SID, s.getNow());
    expect(await s.queue.count()).toBe(1);
  });

  it('업로드하고 7일 지난 원본 덩어리는 폰에서 지운다. 올리지 않은 원본은 절대 지우지 않는다', async () => {
    const s = await setup();
    await s.queue.enqueue('session', SID, s.getNow());
    await syncOnce(s.deps);
    const other = '55555555-5555-4555-8555-555555555555';
    await s.sessions.create({ id: other, courseId: null, courseVersion: null, status: 'processed', startedAt: 0, endedAt: 1, device, calibration: null, summary: null });
    await s.sessions.putChunk({ sessionId: other, seq: 0, gps: [], rawMotion: [], events: [] });
    s.advance(6 * 86_400_000);
    expect(await cleanupUploaded(s.deps)).toBe(0);
    s.advance(2 * 86_400_000);
    expect(await cleanupUploaded(s.deps)).toBe(1);
    expect(await s.sessions.chunks(SID)).toEqual([]);
    expect(await s.sessions.chunks(other)).toHaveLength(1);
    expect(await s.drive.getResult(SID)).toBeTruthy();
  });

  it('원본을 이미 정리한 세션을 다시 올리면 원본 파일은 건너뛰고 처리된 궤적만', async () => {
    const s = await setup();
    await s.queue.enqueue('session', SID, s.getNow());
    await syncOnce(s.deps);
    s.advance(8 * 86_400_000);
    await cleanupUploaded(s.deps);
    s.calls.length = 0;
    await s.queue.enqueue('session', SID, s.getNow());
    await syncOnce(s.deps);
    expect(s.calls).toEqual(['course', 'put processed', 'session', 'laps']);
    expect(s.rows.sessions.at(-1)).toMatchObject({ raw_key: `${USER}/${SID}.raw.json.gz` });
  });
});

describe('표 행 만들기 (사양서 6.5)', () => {
  it('코스·세션·랩 행: 열 이름, 시각은 ISO, 랩타임은 정수 ms', () => {
    expect(courseRow(course)).toMatchObject({ id: CID, kind: 'loop', start_gate: course.startGate, length_m: 111, sector_bounds_m: [37, 74], version: 2 });
    const sr = sessionRow({ id: SID, courseId: CID, courseVersion: 2, status: 'processed', startedAt: Date.UTC(2026, 10, 12), endedAt: null, device, calibration: null, summary: null }, result([]), 'a', 'b');
    expect(sr).toMatchObject({ id: SID, course_id: CID, course_version: 2, started_at: '2026-11-12T00:00:00.000Z', ended_at: null, raw_key: 'a', processed_key: 'b', format_version: 1 });
    const lr = lapRows(SID, result([lap(1, 60_000)]));
    expect(lr[0]).toEqual({ session_id: SID, lap_no: 1, lap_time_ms: 60_000, sector_times_ms: [1000, 2001, null], valid: true, invalid_reason: null, max_speed: 40.12, trace: { stepM: 5, t: [0, 1], v: [1, 2], alt: [null, null] } });
  });
});

describe('코스 행의 기본 코스 키 (카카오 로그인 5.7-1)', () => {
  it('기본 코스면 builtin 키를, 아니면 null을 올린다', async () => {
    const { courseRow } = await import('../../src/sync/rows');
    const base = { id: 'c', name: '배후령', kind: 'point_to_point' as const, source: 'gpx' as const, origin: { lat: 1, lon: 2 }, startGate: { lat: 1, lon: 2, bearingDeg: 0, widthM: 30 }, finishGate: { lat: 1, lon: 2, bearingDeg: 0, widthM: 30 }, centerline: null, lengthM: null, sectorBoundsM: null, version: 1 };
    expect(courseRow({ ...base, builtin: 'baehuryeong' }).builtin).toBe('baehuryeong');
    expect(courseRow(base).builtin).toBeNull();
  });
});
