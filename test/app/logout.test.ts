import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 로그아웃 (설계 5.6·5.7-2, 계획 Task 7): 주행·되살리기 중이거나 올릴 것이 남았으면 막고,
// 통과하면 서버 열쇠를 지우고 폰 저장소·계정 정보를 지운다 (설정은 남김)
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

const API = 'https://gachitayo-api.example.workers.dev';
let fetchMock: ReturnType<typeof vi.fn>;
let serverIds: string[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const device = { os: 'iOS', browser: 'Safari', userAgent: 'ua', standalone: true };

async function load() {
  vi.resetModules();
  const rec = await import('../../src/app/recording');
  const restore = await import('../../src/app/restore');
  const logout = await import('../../src/app/logout');
  const account = await import('../../src/app/account');
  return { rec, restore, logout, account };
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('gachitayo.token', 't'.repeat(43));
  localStorage.setItem('gachitayo.userId', 'u1');
  localStorage.setItem('gachitayo.nickname', '민수');
  localStorage.setItem('gachitayo.onboarded', '1');
  localStorage.setItem('gachitayo.kakao', '1');
  localStorage.setItem('gachitayo.settings', '{"defaultMode":"map"}');
  vi.stubEnv('VITE_API_URL', API);
  serverIds = [];
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/sessions')) return json(200, serverIds.map((id) => ({ id })));
    if (String(url).endsWith('/auth/logout')) return json(200, { ok: true });
    return json(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  const { GachitayoDb } = await import('../../src/storage/db');
  const db = new GachitayoDb();
  await Promise.all(db.tables.map((t) => t.clear()));
  db.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', localStorage);
  vi.restoreAllMocks();
});

const session = (id: string, extra: Record<string, unknown> = {}) => ({ id, courseId: null, courseVersion: null, status: 'uploaded' as const, startedAt: 1, endedAt: null, device, calibration: null, summary: null, ...extra });

describe('로그아웃', () => {
  it('주행 중이면 막는다', async () => {
    const { rec, logout } = await load();
    vi.spyOn(rec, 'getRecordingState').mockReturnValue({ ...rec.getRecordingState(), phase: 'recording' });
    expect(await logout.logoutCheck()).toEqual({ ok: false, error: '주행이나 되살리기가 끝난 뒤에 로그아웃할 수 있어요' });
  });

  it('되살리는 중이면 막는다', async () => {
    const { restore, logout } = await load();
    vi.spyOn(restore, 'getRestoreState').mockReturnValue({ running: true, done: 0, total: 3, failed: 0 });
    expect((await logout.logoutCheck()).ok).toBe(false);
  });

  it('올릴 것이 남았으면 막는다', async () => {
    const { rec, logout } = await load();
    await rec.getQueueRepo().enqueue('session', 's1', 0);
    expect(await logout.logoutCheck()).toEqual({ ok: false, error: '아직 올리지 못한 기록이 있어요. 올린 뒤에 다시 해 주세요' });
  });

  it('통신이 안 되면 막는다', async () => {
    const { logout } = await load();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await logout.logoutCheck()).toEqual({ ok: false, error: '통신이 연결돼야 로그아웃할 수 있어요' });
  });

  it('이 폰에만 있는 기록 수를 알려 준다', async () => {
    const { rec, logout } = await load();
    await rec.getRepo().create(session('a'));
    await rec.getRepo().create(session('b', { imported: true }));
    await rec.getRepo().create(session('c'));
    serverIds = ['a'];
    expect(await logout.logoutCheck()).toEqual({ ok: true, localOnly: 2 });
  });

  it('로그아웃하면 서버 열쇠를 지우고, 폰 기록·코스와 계정 정보를 지운다 (설정은 남김)', async () => {
    const { rec, logout, account } = await load();
    const reload = vi.fn();
    logout.logoutNav.reload = reload;
    await rec.getRepo().create(session('a'));
    await rec.getDriveRepo().putCourse({ id: 'c1', name: 'x', kind: 'loop', source: 'auto', origin: { lat: 1, lon: 2 }, startGate: { lat: 1, lon: 2, bearingDeg: 0, widthM: 30 }, finishGate: { lat: 1, lon: 2, bearingDeg: 0, widthM: 30 }, centerline: null, lengthM: null, sectorBoundsM: null, version: 1 });
    serverIds = ['a'];
    expect(await logout.logout()).toEqual({ ok: true });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/auth/logout'))).toBe(true);
    expect(await rec.getRepo().list()).toEqual([]);
    expect(await rec.getDriveRepo().listCourses()).toEqual([]);
    for (const k of ['gachitayo.token', 'gachitayo.userId', 'gachitayo.nickname', 'gachitayo.onboarded', 'gachitayo.kakao']) expect(localStorage.getItem(k)).toBeNull();
    expect(localStorage.getItem('gachitayo.settings')).toBe('{"defaultMode":"map"}');
    expect(account.getAccountState()).toMatchObject({ status: 'none', onboarded: false, kakao: false, userId: null });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
