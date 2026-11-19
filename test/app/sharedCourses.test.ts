import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '../../src/types/course';
import type { SharedDetail, SharedSummary } from '../../src/types/shared';

// 모두의 코스 앱 상태 (설계 2부): 받기(한 번만·같은 모양이면 있는 코스)·공개·내리기·정렬·열쇠
vi.mock('../../src/app/drive', () => ({ loadCourses: vi.fn(async () => []) }));
vi.mock('../../src/app/account', () => ({ getAuth: () => ({ userId: 'me', token: 'tok' }) }));

const API = 'https://api.example.workers.dev';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let calls: Array<{ method: string; path: string; body: unknown }> = [];
let routes: Record<string, (method: string, body: unknown) => Response> = {};

const gate = (lat: number) => ({ lat, lon: 127.5, bearingDeg: 0, widthM: 30 });
const line = (n: number, from = 37.5): Array<[number, number]> => Array.from({ length: n }, (_, i) => [from + i * 0.0001, 127.5] as [number, number]);
const summary = (id: string, p: Partial<SharedSummary> = {}): SharedSummary => ({ id, name: id, region: '경기', kind: 'point_to_point', lengthM: 1100, start: { lat: 37.5, lon: 127.5 }, thumb: line(3), adds: 0, by: '바람', byId: 'owner', createdAt: 1, mine: false, ...p });
const detail = (id: string, from = 37.5): SharedDetail => ({ ...summary(id), line: line(100, from), startGate: gate(from), finishGate: gate(from + 0.0099), sectorBoundsM: null, status: 'open' });
const myCourse = (p: Partial<Course> = {}): Course => ({
  id: 'c1',
  name: '내 업힐',
  kind: 'point_to_point',
  source: 'auto',
  origin: { lat: 36, lon: 128 },
  startGate: gate(36),
  finishGate: gate(36.01),
  centerline: line(1000, 36),
  lengthM: 1100,
  sectorBoundsM: null,
  version: 3,
  ...p,
});

async function fresh() {
  vi.resetModules();
  const { GachitayoDb } = await import('../../src/storage/db');
  const db = new GachitayoDb();
  await Promise.all(db.tables.map((t) => t.clear()));
  db.close();
  const rec = await import('../../src/app/recording');
  const shared = await import('../../src/app/sharedCourses');
  return { rec, shared };
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', API);
  calls = [];
  routes = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = String(url).replace(API, '');
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, path, body });
      const key = Object.keys(routes).find((k) => new RegExp(`^${k}$`).test(`${method} ${path}`));
      return key ? routes[key]!(method, body) : json(404, { error: '없음' });
    }),
  );
});

describe('받기', () => {
  it('새로 담고 add 한 번, 두 번째는 같은 코스 (add 다시 안 부름)', async () => {
    const { rec, shared } = await fresh();
    routes['GET /api/shared/p1'] = () => json(200, detail('p1'));
    routes['POST /api/shared/p1/add'] = () => json(200, { adds: 1 });
    const c = await shared.addSharedToPhone('p1');
    expect(c).toMatchObject({ source: 'shared', shared: { id: 'p1', by: '바람' } });
    expect((await rec.getDriveRepo().listCourses()).length).toBe(1);
    const again = await shared.addSharedToPhone('p1');
    expect(again.id).toBe(c.id);
    expect(calls.filter((x) => x.path === '/api/shared/p1/add').length).toBe(1);
    expect((await rec.getDriveRepo().listCourses()).length).toBe(1);
  });

  it('이미 같은 모양 코스가 있으면 그 코스', async () => {
    const { rec, shared } = await fresh();
    await rec.getDriveRepo().putCourse(myCourse({ id: 'mine', startGate: gate(37.5), finishGate: gate(37.5099), centerline: line(100), lengthM: 1100 }));
    routes['GET /api/shared/p2'] = () => json(200, detail('p2'));
    routes['POST /api/shared/p2/add'] = () => json(200, { adds: 1 });
    expect((await shared.addSharedToPhone('p2')).id).toBe('mine');
    expect((await rec.getDriveRepo().listCourses()).length).toBe(1);
  });

  it('출발선만 같고 길이·선이 다른 코스가 있으면 새로 담는다 (검토 지적)', async () => {
    const { rec, shared } = await fresh();
    await rec.getDriveRepo().putCourse(myCourse({ id: 'short', startGate: gate(37.5), finishGate: gate(37.5099), centerline: line(20), lengthM: 200 }));
    routes['GET /api/shared/p4'] = () => json(200, detail('p4'));
    routes['POST /api/shared/p4/add'] = () => json(200, { adds: 1 });
    const c = await shared.addSharedToPhone('p4');
    expect(c.id).not.toBe('short');
    expect(c.shared).toEqual({ id: 'p4', by: '바람' });
  });

  it('내가 올린 코스는 "이미 폰에 있음" (publishedId)', async () => {
    const { rec, shared } = await fresh();
    await rec.getDriveRepo().putCourse(myCourse({ id: 'orig', publishedId: 'p5' }));
    expect((await shared.sharedOnPhone('p5'))?.id).toBe('orig');
  });

  it('공개 번호로 내리면 그 내 코스의 공개 표시도 지운다', async () => {
    const { rec, shared } = await fresh();
    await rec.getDriveRepo().putCourse(myCourse({ id: 'orig', publishedId: 'p6', publishedVersion: 3, publishedName: 'x' }));
    routes['DELETE /api/shared/p6'] = () => json(200, { ok: true });
    await shared.unpublishById('p6');
    expect((await rec.getDriveRepo().getCourse('orig'))!.publishedId).toBeUndefined();
  });

  it('코스 200개면 한도 문구', async () => {
    const { rec, shared } = await fresh();
    for (let i = 0; i < 200; i++) await rec.getDriveRepo().putCourse(myCourse({ id: `m${i}`, startGate: gate(30 + i * 0.01), finishGate: gate(30.005 + i * 0.01) }));
    routes['GET /api/shared/p3'] = () => json(200, detail('p3'));
    await expect(shared.addSharedToPhone('p3')).rejects.toThrow('내 코스가 200개예요');
  }, 30_000);
});

describe('공개·고치기·내리기', () => {
  it('공개: 몸에 줄인 선·게이트, 폰 코스에 publishedId·버전·이름', async () => {
    const { rec, shared } = await fresh();
    await rec.getDriveRepo().putCourse(myCourse());
    routes['POST /api/shared'] = () => json(201, { id: 'pub-9' });
    expect(await shared.publishCourse('c1', '강원')).toBe('pub-9');
    const sent = calls.find((x) => x.method === 'POST' && x.path === '/api/shared')!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ name: '내 업힐', region: '강원', startGate: gate(36), finishGate: gate(36.01) });
    expect((sent.line as unknown[]).length).toBeLessThan(100);
    expect(await rec.getDriveRepo().getCourse('c1')).toMatchObject({ publishedId: 'pub-9', publishedVersion: 3, publishedName: '내 업힐' });
  });

  it('아주 긴 코스도 5000점 안으로 줄여 보낸다', async () => {
    const { rec, shared } = await fresh();
    // 1 m 간격 30 km, 12 m 주기로 5 m씩 흔들리는 선 (2 m 로 줄여도 5000점을 넘는다)
    const wig = Array.from({ length: 30_000 }, (_, i) => [36 + i * 0.000009, 128 + Math.sin((i / 12) * Math.PI * 2) * 0.000056] as [number, number]);
    await rec.getDriveRepo().putCourse(myCourse({ centerline: wig, lengthM: 30_000 }));
    routes['POST /api/shared'] = () => json(201, { id: 'pub-long' });
    await shared.publishCourse('c1', '');
    const sent = calls.find((x) => x.method === 'POST' && x.path === '/api/shared')!.body as { line: unknown[] };
    expect(sent.line.length).toBeLessThanOrEqual(5000);
  });

  it('기본 코스·받은 코스는 공개하지 않는다', async () => {
    const { rec, shared } = await fresh();
    await rec.getDriveRepo().putCourse(myCourse({ id: 'b', builtin: 'key' }));
    await rec.getDriveRepo().putCourse(myCourse({ id: 's', shared: { id: 'x', by: 'y' } }));
    await expect(shared.publishCourse('b', '')).rejects.toThrow('내가 만든 코스만 공개할 수 있어요');
    await expect(shared.publishCourse('s', '')).rejects.toThrow('내가 만든 코스만 공개할 수 있어요');
  });

  it('고치기: PUT 하고 버전·이름 갱신, 내리기: publishedId 지움 (서버 404 도 성공)', async () => {
    const { rec, shared } = await fresh();
    await rec.getDriveRepo().putCourse(myCourse({ publishedId: 'pub-1', publishedVersion: 2, publishedName: '옛 이름', name: '새 이름' }));
    routes['PUT /api/shared/pub-1'] = () => json(200, { id: 'pub-1' });
    await shared.updatePublished('c1');
    expect(await rec.getDriveRepo().getCourse('c1')).toMatchObject({ publishedVersion: 3, publishedName: '새 이름' });
    routes['DELETE /api/shared/pub-1'] = () => json(404, { error: '없음' });
    await shared.unpublish('c1');
    const c = (await rec.getDriveRepo().getCourse('c1'))!;
    expect(c.publishedId).toBeUndefined();
    expect(c.publishedVersion).toBeUndefined();
  });
});

describe('목록·정렬', () => {
  it('fetchShared 는 next 로 끝까지 받는다', async () => {
    const { shared } = await fresh();
    routes['GET /api/shared'] = () => json(200, { items: [summary('a'), summary('b')], next: '1:x' });
    routes['GET /api/shared\\?after=1%3Ax'] = () => json(200, { items: [summary('c')], next: null });
    expect((await shared.fetchShared(true)).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('sortShared: 가까운 순(위치 없으면 많이 받은 순)·많이 받은 순·새로 올라온 순', async () => {
    const { shared } = await fresh();
    const list = [summary('far', { start: { lat: 33.5, lon: 126.5 }, adds: 9, createdAt: 1 }), summary('near', { start: { lat: 37.5, lon: 127 }, adds: 1, createdAt: 3 }), summary('mid', { start: { lat: 36, lon: 127.5 }, adds: 5, createdAt: 2 })];
    expect(shared.sortShared(list, 'near', { lat: 37.56, lon: 126.97 }).map((s) => s.id)).toEqual(['near', 'mid', 'far']);
    expect(shared.sortShared(list, 'near', null).map((s) => s.id)).toEqual(['far', 'mid', 'near']);
    expect(shared.sortShared(list, 'adds', null).map((s) => s.id)).toEqual(['far', 'mid', 'near']);
    expect(shared.sortShared(list, 'new', null).map((s) => s.id)).toEqual(['near', 'mid', 'far']);
  });
});

describe('열쇠', () => {
  it('courseKey: 기본 코스 b:, 받은 코스 s:, 내 코스 null', async () => {
    const { shared } = await fresh();
    expect(shared.courseKey(myCourse({ builtin: 'haogogae' }))).toBe('b:haogogae');
    expect(shared.courseKey(myCourse({ shared: { id: 'p1', by: 'x' } }))).toBe('s:p1');
    expect(shared.courseKey(myCourse())).toBeNull();
  });

  it('즐겨찾기 열쇠·인기 줄도 받은 코스는 s:{id}', async () => {
    const { prefKey } = await import('../../src/app/coursePrefs');
    expect(prefKey(myCourse({ shared: { id: 'p1', by: 'x' } }))).toBe('s:p1');
    const { filterCourses } = await import('../../src/app/courseFilter');
    const c = myCourse({ id: 'got', shared: { id: 'p1', by: 'x' } });
    const out = filterCourses([c], 'popular', { isFavorite: () => false, tagsOf: () => [] }, [{ builtin: 's:p1', drivers: 4 }]);
    expect(out).toEqual([{ course: c, drivers: 4 }]);
  });

  it('받은 코스를 달리면 drove 신호도 s:{id}', async () => {
    const { droveKeyOf } = await import('../../src/app/droveSignal');
    expect(droveKeyOf({ laps: [{ valid: true }] } as never, myCourse({ shared: { id: 'p1', by: 'x' } }), Date.now())).toBe('s:p1');
  });
});

describe('신고·차단·관리자', () => {
  it('신고·안 보기·풀기·관리자 부르기가 맞는 주소로 간다', async () => {
    const { shared } = await fresh();
    routes['POST /api/shared/p1/report'] = () => json(200, { ok: true });
    routes['POST /api/blocks'] = () => json(200, { ok: true });
    routes['DELETE /api/blocks/u9'] = () => json(200, { ok: true });
    routes['GET /api/blocks'] = () => json(200, [{ userId: 'u9', nickname: '나쁜사람' }]);
    routes['POST /api/admin/shared/p1'] = () => json(200, { ok: true });
    routes['POST /api/admin/bans'] = () => json(200, { ok: true });
    await shared.reportShared('p1', 'danger', '  밤에 위험  ');
    await shared.blockUser('u9');
    expect(await shared.listBlocks()).toEqual([{ userId: 'u9', nickname: '나쁜사람' }]);
    await shared.unblockUser('u9');
    await shared.adminSet('p1', 'hide');
    await shared.adminBan('u9');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/shared/p1/report', 'POST /api/blocks', 'GET /api/blocks', 'DELETE /api/blocks/u9', 'POST /api/admin/shared/p1', 'POST /api/admin/bans']);
    expect(calls[0]!.body).toEqual({ reason: 'danger', note: '밤에 위험' });
  });
});
