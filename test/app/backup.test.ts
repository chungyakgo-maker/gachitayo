import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '../../src/types/course';
import type { SessionRecord } from '../../src/types/session';

// 백업 파일 만들기·불러오기 (기록은 폰에만 5단계, 시안 ②③): 없는 것만 더하고, 기본 코스·같은 모양 코스는 있는 코스로 잇는다
vi.mock('../../src/app/drive', () => ({ loadCourses: vi.fn(async () => []) }));

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);

const device = { os: 'iOS', browser: 'Safari', userAgent: 'ua', standalone: true };
const gate = (lat: number) => ({ lat, lon: 127.1, bearingDeg: 0, widthM: 30 });
const course = (id: string, p: Partial<Course> = {}): Course => ({
  id,
  name: id,
  kind: 'point_to_point',
  source: 'auto',
  origin: { lat: 37.2, lon: 127.1 },
  startGate: gate(37.2),
  finishGate: gate(37.21),
  centerline: [
    [37.2, 127.1],
    [37.21, 127.1],
  ],
  lengthM: 1100,
  sectorBoundsM: null,
  version: 1,
  ...p,
});
const session = (id: string, courseId: string | null, startedAt = 1_800_000_000_000): SessionRecord => ({ id, courseId, courseVersion: 1, status: 'processed', startedAt, endedAt: null, device, calibration: null, summary: null });
const gps = [
  { t: 0, tRecv: 0, tFix: 0, lat: 37.2, lon: 127.1, alt: null, altAcc: null, hAcc: 5, speed: 10, heading: 0 },
  { t: 1000, tRecv: 1000, tFix: 1000, lat: 37.2001, lon: 127.1, alt: null, altAcc: null, hAcc: 5, speed: 10, heading: 0 },
];

async function fresh() {
  // 폰 하나를 새로 꺼낸 것처럼: 저장소·localStorage 를 비운다
  storage.clear();
  vi.resetModules();
  const { GachitayoDb } = await import('../../src/storage/db');
  const db = new GachitayoDb();
  await Promise.all(db.tables.map((t) => t.clear()));
  db.close();
  const rec = await import('../../src/app/recording');
  const backup = await import('../../src/app/backup');
  const prefs = await import('../../src/app/coursePrefs');
  return { rec, backup, prefs };
}
async function addSession(rec: Awaited<ReturnType<typeof fresh>>['rec'], s: SessionRecord, withRaw: boolean) {
  await rec.getRepo().create(s);
  if (withRaw) await rec.getRepo().putChunk({ sessionId: s.id, seq: 0, gps: gps as never, rawMotion: [], events: [{ t: 0, type: 'start' }] });
  await rec.getDriveRepo().putResult({ sessionId: s.id, courseId: s.courseId, courseVersion: 1, processedAt: 1, laps: [] } as never);
  if (s.courseId) await rec.getDriveRepo().putRefLaps([{ id: `${s.id}:1`, courseId: s.courseId, courseVersion: 1, sessionId: s.id, lapNo: 1, startedAt: 1, lapTimeMs: 60_000, sectorTimesMs: [1, 2, 3], trace: { stepM: 5, t: [0], v: [0], alt: [null] } }]);
}

beforeEach(() => storage.clear());

describe('백업 만들기', () => {
  it('파일 이름 "디고 백업 YYYY-MM-DD.dgo"(한국 날짜), 기록·코스·원본이 들어간다', async () => {
    const { rec, backup } = await fresh();
    await rec.getDriveRepo().putCourse(course('c1'));
    await addSession(rec, session('s1', 'c1'), true);
    await addSession(rec, session('s2', null), false);
    const file = await backup.createBackupFile(Date.UTC(2026, 10, 18, 20, 0)); // 한국 11월 19일 05시
    expect(file.name).toBe('디고 백업 2026-11-19.dgo');
    const m = await backup.peekBackup(file);
    expect(m).toMatchObject({ format: 'dgo-backup', sessions: 2, courses: 1 });
  });

  it('주행 중·일반 주행 기록은 넣지 않는다', async () => {
    const { rec, backup } = await fresh();
    await addSession(rec, session('ok', null), false);
    await rec.getRepo().create({ ...session('rec', null), status: 'recording' });
    await rec.getRepo().create({ ...session('nr', null), noRecord: true });
    expect((await backup.peekBackup(await backup.createBackupFile())).sessions).toBe(1);
  });
});

describe('백업 불러오기', () => {
  it('없는 것만 더한다: 폰에 1개, 백업에 3개(1개 겹침) → 2개 더함, 1개 건너뜀', async () => {
    const a = await fresh();
    await a.rec.getDriveRepo().putCourse(course('c1'));
    for (const id of ['s1', 's2', 's3']) await addSession(a.rec, session(id, 'c1'), id !== 's3');
    const file = await a.backup.createBackupFile();
    const b = await fresh();
    await addSession(b.rec, session('s1', null), false);
    expect(await b.backup.importBackup(file)).toEqual({ sessions: 2, courses: 1, skipped: 1 });
    expect((await b.rec.getRepo().chunks('s2')).length).toBe(1);
    expect((await b.rec.getDriveRepo().refLaps('c1', 1)).map((l) => l.sessionId).sort()).toEqual(['s2', 's3']);
  });

  it('같은 파일 두 번 불러와도 개수 그대로', async () => {
    const a = await fresh();
    await a.rec.getDriveRepo().putCourse(course('c1'));
    await addSession(a.rec, session('s1', 'c1'), true);
    const file = await a.backup.createBackupFile();
    const b = await fresh();
    await b.backup.importBackup(file);
    expect(await b.backup.importBackup(file)).toEqual({ sessions: 0, courses: 0, skipped: 1 });
    expect((await b.rec.getRepo().list()).length).toBe(1);
    expect((await b.rec.getDriveRepo().listCourses()).length).toBe(1);
  });

  it('기본 코스는 그 폰의 같은 기본 코스로 잇는다 (새 코스 안 생김, 기록 courseId 가 폰의 것으로)', async () => {
    const a = await fresh();
    await a.rec.getDriveRepo().putCourse(course('old-b', { builtin: 'haogogae' }));
    await addSession(a.rec, session('s1', 'old-b'), false);
    const file = await a.backup.createBackupFile();
    const b = await fresh();
    await b.rec.getDriveRepo().putCourse(course('new-b', { builtin: 'haogogae', version: 3 }));
    expect(await b.backup.importBackup(file)).toEqual({ sessions: 1, courses: 0, skipped: 0 });
    expect((await b.rec.getRepo().get('s1'))!).toMatchObject({ courseId: 'new-b', courseVersion: 3 });
    expect((await b.rec.getDriveRepo().getResult('s1'))!).toMatchObject({ courseId: 'new-b', courseVersion: 3 });
    expect((await b.rec.getDriveRepo().refLaps('new-b', 3)).length).toBe(1);
    expect((await b.rec.getDriveRepo().listCourses()).map((c) => c.id)).toEqual(['new-b']);
  });

  it('같은 모양 코스는 있는 코스로 (sameCourse)', async () => {
    const a = await fresh();
    await a.rec.getDriveRepo().putCourse(course('mine-a', { name: '내 업힐' }));
    await addSession(a.rec, session('s1', 'mine-a'), false);
    const file = await a.backup.createBackupFile();
    const b = await fresh();
    await b.rec.getDriveRepo().putCourse(course('mine-b', { name: '업힐' }));
    expect((await b.backup.importBackup(file)).courses).toBe(0);
    expect((await b.rec.getRepo().get('s1'))!.courseId).toBe('mine-b');
  });

  it('코스 한도를 넘으면 아무것도 바꾸지 않고 한도 문구', async () => {
    const a = await fresh();
    await a.rec.getDriveRepo().putCourse(course('far', { startGate: gate(36), finishGate: gate(36.01) }));
    await addSession(a.rec, session('s1', 'far'), false);
    const file = await a.backup.createBackupFile();
    const b = await fresh();
    for (let i = 0; i < 200; i++) await b.rec.getDriveRepo().putCourse(course(`m${i}`, { startGate: gate(38 + i * 0.01), finishGate: gate(38.005 + i * 0.01) }));
    await expect(b.backup.importBackup(file)).rejects.toThrow('내 코스가 200개예요');
    expect(await b.rec.getRepo().get('s1')).toBeUndefined();
  }, 30_000);

  it('즐겨찾기는 합친다', async () => {
    const a = await fresh();
    a.prefs.toggleFavorite({ id: 'x', builtin: 'haogogae' } as Course);
    const file = await a.backup.createBackupFile();
    const b = await fresh();
    b.prefs.toggleFavorite({ id: 'c9' } as Course);
    await b.backup.importBackup(file);
    expect(b.prefs.getCoursePrefs().favorites.sort()).toEqual(['b:haogogae', 'c9']);
  });

  it('디고 백업 파일이 아니면 아무것도 바꾸지 않는다', async () => {
    const b = await fresh();
    await expect(b.backup.importBackup(new File([new Uint8Array([1, 2, 3])], 'x.dgo'))).rejects.toThrow('디고 백업 파일이 아니에요');
    expect((await b.rec.getRepo().list()).length).toBe(0);
  });

  it('불러온 뒤 원본은 최근 30개만', async () => {
    const a = await fresh();
    for (let i = 0; i < 32; i++) await addSession(a.rec, session(`s${i}`, null, 1_800_000_000_000 + i * 1000), true);
    const file = await a.backup.createBackupFile();
    const b = await fresh();
    await b.backup.importBackup(file);
    expect((await b.rec.getRepo().chunks('s0')).length).toBe(0);
    expect((await b.rec.getRepo().chunks('s31')).length).toBe(1);
  }, 30_000);
});

describe('마지막 백업·알림', () => {
  const DAY = 86_400_000;
  it('만든 때·크기를 기억한다', async () => {
    const { backup } = await fresh();
    expect(backup.lastBackup()).toBeNull();
    backup.markBackedUp(38_000_000, 1_900_000_000_000);
    expect(backup.lastBackup()).toEqual({ at: 1_900_000_000_000, bytes: 38_000_000 });
  });

  it('기록 5개 이상 + 마지막 백업(없으면 첫 기록) 뒤 30일 → 알림, 닫으면 30일 동안 안 뜸', async () => {
    const { backup } = await fresh();
    const now = 1_900_000_000_000;
    expect(backup.backupReminderDue(now, 5, now - 31 * DAY)).toBe(true);
    expect(backup.backupReminderDue(now, 5, now - 29 * DAY)).toBe(false);
    expect(backup.backupReminderDue(now, 4, now - 90 * DAY)).toBe(false);
    backup.markBackedUp(1, now - 29 * DAY);
    expect(backup.backupReminderDue(now, 9, now - 90 * DAY)).toBe(false);
    backup.markBackedUp(1, now - 31 * DAY);
    expect(backup.backupReminderDue(now, 9, now - 90 * DAY)).toBe(true);
    backup.snoozeBackupReminder(now);
    expect(backup.backupReminderDue(now + 29 * DAY, 9, now - 90 * DAY)).toBe(false);
    expect(backup.backupReminderDue(now + 31 * DAY, 9, now - 90 * DAY)).toBe(true);
  });
});
