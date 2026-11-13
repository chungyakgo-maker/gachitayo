import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipJson } from '../../src/storage/gzip';
import { buildRawFile } from '../../src/storage/rawFile';
import type { SessionRecord } from '../../src/types/session';
import type { Course } from '../../src/types/course';

// 되살리기 (설계 5.7·5.7-1·5.7-2): 서버에 있고 폰에 없는 기록은 원본을 받아 같은 id로 다시 계산한다
const processRestoredSession = vi.fn(async (_id: string) => ({}));
vi.mock('../../src/app/drive', () => ({ processRestoredSession: (id: string) => processRestoredSession(id), loadCourses: vi.fn(async () => []) }));

const API = 'https://gachitayo-api.example.workers.dev';
const ME = '11111111-1111-4111-8111-111111111111';
let fetchMock: ReturnType<typeof vi.fn>;
let serverCourses: unknown[] = [];
let serverSessions: Array<Record<string, unknown>> = [];
const files = new Map<string, Uint8Array<ArrayBuffer>>();
let failFile: string | null = null;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const device = { os: 'iOS 18', browser: 'Safari', userAgent: 'ua', standalone: true };
const gps = [
  { t: 0, tRecv: 0, lat: 37.9, lon: 127.7, alt: null, hAcc: 5, vAcc: null, speed: 10, heading: 90 },
  { t: 1000, tRecv: 1000, lat: 37.9001, lon: 127.7, alt: null, hAcc: 5, vAcc: null, speed: 10, heading: 90 },
];
async function rawBytes(id: string) {
  const s: SessionRecord = { id, courseId: null, courseVersion: null, status: 'uploaded', startedAt: 1_800_000_000_000, endedAt: null, device, calibration: null, summary: null };
  return gzipJson(buildRawFile(s, [{ sessionId: id, seq: 0, gps, rawMotion: [], events: [{ t: 0, type: 'start' }] } as never]));
}
async function serverSession(p: { courseId?: string | null; courseVersion?: number | null; withRaw?: boolean } = {}) {
  const id = crypto.randomUUID();
  const withRaw = p.withRaw ?? true;
  if (withRaw) files.set(`${ME}/${id}.raw.json.gz`, await rawBytes(id));
  serverSessions.push({
    id,
    courseId: p.courseId ?? null,
    courseVersion: p.courseVersion ?? null,
    startedAt: new Date(1_800_000_000_000 + serverSessions.length * 1000).toISOString(),
    endedAt: new Date(1_800_000_060_000).toISOString(),
    device,
    rawKey: withRaw ? `${ME}/${id}.raw.json.gz` : null,
    processedKey: `${ME}/${id}.processed.json.gz`,
    formatVersion: 1,
  });
  return id;
}
const gate = (lat: number, lon: number) => ({ lat, lon, bearingDeg: 0, widthM: 30 });
const serverCourse = (p: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  name: '내 코스',
  kind: 'point_to_point',
  source: 'gpx',
  origin: { lat: 37.9, lon: 127.7 },
  start_gate: gate(37.9, 127.7),
  finish_gate: gate(37.91, 127.7),
  centerline: [
    [37.9, 127.7],
    [37.91, 127.7],
  ],
  length_m: 1100,
  sector_bounds_m: null,
  version: 1,
  builtin: null,
  ...p,
});
const localBuiltin = (key: string, name: string, id: string = crypto.randomUUID()): Course => ({
  id,
  name,
  kind: 'point_to_point',
  source: 'gpx',
  origin: { lat: 37.95, lon: 127.75 },
  startGate: gate(37.95, 127.75),
  finishGate: gate(37.96, 127.75),
  centerline: [
    [37.95, 127.75],
    [37.96, 127.75],
  ],
  lengthM: 1100,
  sectorBoundsM: null,
  version: 3,
  builtin: key,
});

// 노드 환경: 계정 모듈이 쓰는 localStorage 대신
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
const localStorage = new MemoryStorage();
vi.stubGlobal('localStorage', localStorage);

async function load() {
  vi.resetModules();
  const rec = await import('../../src/app/recording');
  const restore = await import('../../src/app/restore');
  return { rec, restore };
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('gachitayo.token', 't'.repeat(43));
  localStorage.setItem('gachitayo.userId', ME);
  localStorage.setItem('gachitayo.onboarded', '1');
  localStorage.setItem('gachitayo.kakao', '1');
  vi.stubEnv('VITE_API_URL', API);
  serverCourses = [];
  serverSessions = [];
  files.clear();
  failFile = null;
  processRestoredSession.mockClear();
  fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    if (url === `${API}/api/courses`) return json(200, serverCourses);
    if (url === `${API}/api/sessions`) return json(200, serverSessions);
    const f = /\/files\/(.+)$/.exec(url);
    if (f) {
      if (f[1] === failFile) return json(500, { error: '서버 오류' });
      const b = files.get(f[1]!);
      return b ? new Response(b as Uint8Array<ArrayBuffer>, { status: 200 }) : json(404, { error: '없음' });
    }
    return json(404, { error: url });
  });
  vi.stubGlobal('fetch', fetchMock);
  // 저장소 비우기 (테스트끼리 같은 fake IndexedDB)
  const { GachitayoDb } = await import('../../src/storage/db');
  const db = new GachitayoDb();
  await Promise.all(db.tables.map((t) => t.clear()));
  db.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', localStorage);
});

describe('되살리기', () => {
  it('폰에 없는 기록만 같은 id로 받아 다시 계산하고, 다시 올리지 않는다', async () => {
    const have = await serverSession();
    const missing = await serverSession();
    const { rec, restore } = await load();
    await rec.getRepo().create({ id: have, courseId: null, courseVersion: null, status: 'uploaded', startedAt: 1, endedAt: null, device, calibration: null, summary: null, uploadedAt: 5 });
    await restore.startRestore();
    expect(processRestoredSession.mock.calls.map((c) => c[0])).toEqual([missing]);
    const got = (await rec.getRepo().get(missing))!;
    expect(got).toMatchObject({ id: missing, status: 'uploaded', startedAt: 1_800_000_001_000, device });
    expect(got.uploadedAt).toBeGreaterThan(0);
    expect(got.imported).toBeFalsy();
    expect((await rec.getRepo().chunks(missing))[0]!.gps.length).toBe(2);
    expect(await rec.getQueueRepo().count()).toBe(0);
    expect(restore.getRestoreState()).toMatchObject({ running: false, done: 1, total: 1, failed: 0 });
  });

  it('서버의 기본 코스(키 있음)를 쓴 기록은 폰의 같은 기본 코스로 이어 붙이고, 코스를 새로 넣지 않는다', async () => {
    const sc = serverCourse({ name: '배후령', builtin: 'baehuryeong' });
    serverCourses = [sc];
    const sid = await serverSession({ courseId: sc.id as string, courseVersion: 1 });
    const { rec, restore } = await load();
    const mine = localBuiltin('baehuryeong', '배후령');
    await rec.getDriveRepo().putCourse(mine);
    await restore.startRestore();
    expect((await rec.getRepo().get(sid))!).toMatchObject({ courseId: mine.id, courseVersion: 3 });
    const courses = await rec.getDriveRepo().listCourses();
    expect(courses.filter((c) => c.name === '배후령')).toHaveLength(1);
  });

  it('키 없이 올라간 예전 기본 코스는 이름과 출발선(30 m 안)으로 알아본다', async () => {
    const mine = localBuiltin('baehuryeong', '배후령');
    const sc = serverCourse({ name: '배후령', start_gate: gate(37.9501, 127.75) });
    const far = serverCourse({ name: '배후령', start_gate: gate(37.96, 127.75) });
    serverCourses = [sc, far];
    const sid = await serverSession({ courseId: sc.id as string, courseVersion: 1 });
    const { rec, restore } = await load();
    await rec.getDriveRepo().putCourse(mine);
    await restore.startRestore();
    expect((await rec.getRepo().get(sid))!.courseId).toBe(mine.id);
    // 출발선이 먼 같은 이름 코스는 기본 코스가 아니라 내 코스로 들어온다
    expect(await rec.getDriveRepo().getCourse(far.id as string)).toBeDefined();
  });

  it('내 코스는 폰에 없거나 서버가 더 새 버전이면 넣는다', async () => {
    const a = serverCourse({ name: '새 코스' });
    const b = serverCourse({ name: '고친 코스', version: 4 });
    serverCourses = [a, b];
    const { rec, restore } = await load();
    await rec.getDriveRepo().putCourse({ ...localBuiltin('x', '고친 코스', b.id), builtin: undefined, version: 2 });
    await restore.startRestore();
    expect((await rec.getDriveRepo().getCourse(a.id as string))!.name).toBe('새 코스');
    expect((await rec.getDriveRepo().getCourse(b.id as string))!.version).toBe(4);
  });

  it('원본이 서버에 없는 기록은 건너뛴다', async () => {
    const sid = await serverSession({ withRaw: false });
    const { rec, restore } = await load();
    await restore.startRestore();
    expect(await rec.getRepo().get(sid)).toBeUndefined();
    expect(processRestoredSession).not.toHaveBeenCalled();
  });

  it('중간에 실패하면 그 기록은 남기지 않고, 다음에 그것만 다시 받는다 (중복 없음)', async () => {
    const a = await serverSession();
    const b = await serverSession();
    failFile = `${ME}/${a}.raw.json.gz`;
    const { rec, restore } = await load();
    await restore.startRestore();
    expect(restore.getRestoreState()).toMatchObject({ done: 1, total: 2, failed: 1 });
    expect(await rec.getRepo().get(a)).toBeUndefined();
    expect(await rec.getRepo().get(b)).toBeDefined();
    failFile = null;
    processRestoredSession.mockClear();
    await restore.startRestore();
    expect(processRestoredSession.mock.calls.map((c) => c[0])).toEqual([a]);
    expect((await rec.getRepo().list()).length).toBe(2);
  });

  it('폰에만 있는 기록은 원본이 있으면 올리고, PC에서 가져온 기록은 올리지 않는다', async () => {
    const { rec, restore } = await load();
    const local = crypto.randomUUID();
    const imported = crypto.randomUUID();
    const noRaw = crypto.randomUUID();
    for (const [id, extra] of [
      [local, { uploadedAt: 99 }],
      [imported, { imported: true }],
      [noRaw, { uploadedAt: 99 }],
    ] as const) {
      await rec.getRepo().create({ id, courseId: null, courseVersion: null, status: 'uploaded', startedAt: 1, endedAt: null, device, calibration: null, summary: null, ...extra });
      if (id !== noRaw) await rec.getRepo().putChunk({ sessionId: id, seq: 0, gps, rawMotion: [], events: [] } as never);
    }
    await restore.startRestore();
    const queued = (await rec.getQueueRepo().all()).map((q) => q.targetId);
    expect(queued).toEqual([local]);
    expect((await rec.getRepo().get(local))!).toMatchObject({ status: 'processed', uploadedAt: null });
    expect((await restore.localOnlySessions()).map((s) => s.id).sort()).toEqual([local, imported, noRaw].sort());
  });

  it('주행(기록) 중에는 하지 않고, 끝난 뒤에 한다', async () => {
    await serverSession();
    const { rec, restore } = await load();
    const st = rec.getRecordingState() as { phase: string };
    const spy = vi.spyOn(rec, 'getRecordingState').mockReturnValue({ ...st, phase: 'recording' } as never);
    const p = restore.startRestore();
    await new Promise((r) => setTimeout(r, 20));
    expect(processRestoredSession).not.toHaveBeenCalled();
    spy.mockRestore();
    restore.recordingSettled();
    await p;
    expect(processRestoredSession).toHaveBeenCalledTimes(1);
  });
});
