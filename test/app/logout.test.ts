import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 로그아웃 (설계 5.6, 기록은 폰에만 6단계): 주행·옮기기 중이면 막는다. 서버 열쇠를 지우고(통신이 안 돼도 폰은 로그아웃)
// 계정 정보를 지운다. 기록·코스·즐겨찾기는 기본으로 남기고, "지우기"를 골랐을 때만 지운다 (설정은 늘 남김)
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
    expect(await logout.logoutCheck()).toEqual({ ok: false, error: '주행이나 옮기기가 끝난 뒤에 로그아웃할 수 있어요' });
  });

  it('되살리는 중이면 막는다', async () => {
    const { restore, logout } = await load();
    vi.spyOn(restore, 'getRestoreState').mockReturnValue({ running: true, done: 0, total: 3, failed: 0 });
    expect((await logout.logoutCheck()).ok).toBe(false);
  });

  it('업로드 대기가 남아 있어도 막지 않는다 (기록은 폰에만)', async () => {
    const { rec, logout } = await load();
    await rec.getQueueRepo().enqueue('session', 's1', 0);
    expect(await logout.logoutCheck()).toEqual({ ok: true });
  });

  it('통신 실패해도 폰은 로그아웃, 기록·코스·즐겨찾기는 그대로 (기본)', async () => {
    const { rec, logout, account } = await load();
    logout.logoutNav.reload = vi.fn();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    localStorage.setItem('gachitayo.coursePrefs.v1', JSON.stringify({ prefs: { favorites: ['c1'], tags: {} } }));
    await rec.getRepo().create(session('a'));
    expect(await logout.logout({ wipe: false })).toEqual({ ok: true });
    expect((await rec.getRepo().list()).map((s) => s.id)).toEqual(['a']);
    expect(localStorage.getItem('gachitayo.coursePrefs.v1')).not.toBeNull();
    expect(localStorage.getItem('gachitayo.token')).toBeNull();
    expect(account.getAccountState()).toMatchObject({ status: 'none', userId: null });
  });

  it('지우기를 고르면 서버 열쇠를 지우고, 폰 기록·코스와 계정 정보를 지운다 (기본 코스·설정은 남김)', async () => {
    const { rec, logout, account } = await load();
    const reload = vi.fn();
    logout.logoutNav.reload = reload;
    await rec.getRepo().create(session('a'));
    const c = { id: 'c1', name: 'x', kind: 'loop' as const, source: 'auto' as const, origin: { lat: 1, lon: 2 }, startGate: { lat: 1, lon: 2, bearingDeg: 0, widthM: 30 }, finishGate: { lat: 1, lon: 2, bearingDeg: 0, widthM: 30 }, centerline: null, lengthM: null, sectorBoundsM: null, version: 1 };
    await rec.getDriveRepo().putCourse(c);
    // 기본 코스는 남긴다 (설계 5.6, 출발·도착선 고친 것도 그대로)
    await rec.getDriveRepo().putCourse({ ...c, id: 'b1', name: '배후령', builtin: 'baehuryeong' });
    await rec.getDriveRepo().putRefLaps([{ id: 'r1', sessionId: 'a', courseId: 'b1', courseVersion: 1, lapNo: 1, lapTimeMs: 60000 } as never]);
    serverIds = ['a'];
    expect(await logout.logout({ wipe: true })).toEqual({ ok: true });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/auth/logout'))).toBe(true);
    expect(await rec.getRepo().list()).toEqual([]);
    expect((await rec.getDriveRepo().listCourses()).map((c) => c.id)).toEqual(['b1']);
    expect(await rec.getDriveRepo().refLaps('b1', 1)).toEqual([]);
    for (const k of ['gachitayo.token', 'gachitayo.userId', 'gachitayo.nickname', 'gachitayo.onboarded', 'gachitayo.kakao']) expect(localStorage.getItem(k)).toBeNull();
    // 설정은 남는다 (불러올 때 확대 되돌리기로 다른 칸이 채워질 수는 있다, 2026-11-18)
    expect(JSON.parse(localStorage.getItem('gachitayo.settings') ?? 'null')).toMatchObject({ defaultMode: 'map' });
    expect(account.getAccountState()).toMatchObject({ status: 'none', onboarded: false, kakao: false, userId: null });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
