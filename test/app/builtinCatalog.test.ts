// 기본 코스를 서버 목록으로 (2026-11-27 세영 "코스 추가될 때마다 앱 배포 다시 안 하는 방향으로 … 웹 앱 통일"):
// 앱을 열면 서버 목록을 받아 새 코스를 넣고, 고침(rev)이 오른 코스만 새 선으로. 통신이 없으면 받아 둔 목록 · 앱에 묶인 목록
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_POINTS } from '../../src/courses/builtinData';
import { BUNDLED_BUILTINS } from '../../src/courses/builtinMeta';

// 폰 저장소 (node 시험 환경에는 없다)
const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

const calls: string[] = [];
let server: { catalog: unknown; points: Record<string, { rev: number; points: number[] }> } | null = null;
vi.mock('../../src/server/config', () => ({ serverConfig: { apiUrl: 'https://api.test' }, accountEnabled: () => true }));
vi.mock('../../src/server/api', () => ({
  apiFetch: vi.fn(async (_m: string, path: string) => {
    calls.push(path);
    if (!server) throw new Error('offline');
    if (path === '/api/builtin-courses') return server.catalog;
    const key = path.split('/').pop()!;
    const p = server.points[key];
    if (!p) throw new Error('404');
    return { key, ...p };
  }),
}));
vi.mock('../../src/app/drive', () => ({ loadCourses: vi.fn(async () => []), processSession: vi.fn(async () => null) }));

const rec = await import('../../src/app/recording');
const catalog = await import('../../src/courses/catalog');

// 남양주 어딘가 작은 고리 (새 서킷)
const loop: number[] = [];
for (let k = 0; k <= 60; k++) {
  const a = (k / 60) * 2 * Math.PI;
  loop.push(37.6 + 0.004 * Math.sin(a), 127.2 + 0.005 * Math.cos(a));
}
const NEW = { key: 'new-circuit', name: '새 서킷', route: '경기 · 서킷 한 바퀴', tags: ['circuit'], desc: ['한 줄 설명'] };
// 인제 선을 서버에서 고쳤다 (rev 3): 점을 조금 옮긴 선
const injeMoved = BUILTIN_POINTS['inje-speedium']!.map((v, i) => (i % 2 === 0 ? v + 0.0003 : v));

async function fresh() {
  vi.resetModules();
  return (await import('../../src/app/courses')).seedBuiltinCourses;
}
const listBuiltins = async () => (await rec.getDriveRepo().listCourses()).filter((c) => c.builtin);

beforeEach(async () => {
  calls.length = 0;
  server = null;
  catalog.resetBuiltinCatalog();
  (await import('../../src/courses/catalog')).resetBuiltinCatalog();
  for (const c of await rec.getDriveRepo().listCourses()) await rec.getDriveRepo().deleteCourse(c.id);
});

describe('기본 코스 서버 목록', () => {
  it('통신이 없으면 앱에 묶인 목록·점으로 넣는다 (처음 설치 직후 산속)', async () => {
    const { seedBuiltinCourses } = await import('../../src/app/courses');
    await seedBuiltinCourses();
    const got = await listBuiltins();
    expect(got.map((c) => c.builtin).sort()).toEqual(BUNDLED_BUILTINS.map((b) => b.key).sort());
    expect(got.every((c) => c.builtinRev === (BUNDLED_BUILTINS.find((b) => b.key === c.builtin)!.rev ?? 1) && c.builtinBase === 1)).toBe(true);
  });

  it('서버 목록에 새 코스가 있으면 점을 받아 넣고, 고침이 오른 코스만 새 선으로 (버전 +1). 목록은 이 폰에 두어 다음엔 통신 없이도 쓴다', async () => {
    await (await fresh())();
    const before = (await listBuiltins()).find((c) => c.builtin === 'inje-speedium')!;
    server = {
      catalog: { courses: [...BUNDLED_BUILTINS.map((b) => (b.key === 'inje-speedium' ? { ...b, rev: 3 } : b)), NEW] },
      points: { 'new-circuit': { rev: 1, points: loop }, 'inje-speedium': { rev: 3, points: injeMoved } },
    };
    await (await fresh())();
    const got = await listBuiltins();
    const added = got.find((c) => c.builtin === 'new-circuit')!;
    expect(added).toMatchObject({ name: '새 서킷', kind: 'loop', builtinRev: 1, builtinBase: 1 });
    // 화면이 읽는 목록에도 (새로 불러온 모듈 = 앱 안에서 같은 하나)
    expect((await import('../../src/courses/builtin')).builtinInfo(added)?.desc).toEqual(['한 줄 설명']);
    expect((await import('../../src/app/coursePrefs')).tagsOf(added)).toEqual(['circuit']);
    const inje = got.find((c) => c.builtin === 'inje-speedium')!;
    expect(inje).toMatchObject({ id: before.id, version: 2, builtinRev: 3, builtinBase: 2 });
    expect(inje.startGate.lat).toBeGreaterThan(before.startGate.lat);
    // 다른 기본 코스는 점을 받지 않는다 (앱에 묶인 점과 고침이 같아서)
    expect(calls.filter((p) => p.startsWith('/api/builtin-courses/'))).toEqual(['/api/builtin-courses/inje-speedium', '/api/builtin-courses/new-circuit']);
    // 다음 실행: 통신이 없어도 받아 둔 목록으로 (새 코스가 목록에 남는다)
    server = null;
    await (await fresh())();
    expect((await import('../../src/courses/catalog')).builtinCatalog().some((b) => b.key === 'new-circuit')).toBe(true);
    expect((await listBuiltins()).length).toBe(got.length);
  });

  it('사용자가 선을 고친 기본 코스는 서버에서 고침이 올라도 덮지 않는다', async () => {
    await (await fresh())();
    const drive = rec.getDriveRepo();
    const inje = (await listBuiltins()).find((c) => c.builtin === 'inje-speedium')!;
    const mine = { ...inje, version: inje.version + 1, startGate: { ...inje.startGate, bearingDeg: 45 } };
    await drive.putCourse(mine);
    server = { catalog: { courses: BUNDLED_BUILTINS.map((b) => (b.key === 'inje-speedium' ? { ...b, rev: 3 } : b)) }, points: { 'inje-speedium': { rev: 3, points: injeMoved } } };
    await (await fresh())();
    expect(await drive.getCourse(inje.id)).toEqual(mine);
  });

  it('이상한 목록은 받지 않는다 (예전 목록 그대로)', () => {
    expect(catalog.parseCatalog(null)).toBeNull();
    expect(catalog.parseCatalog({ courses: [] })).toBeNull();
    expect(catalog.parseCatalog({ courses: [{ key: 'a', name: 'A' }] })).toBeNull();
    expect(catalog.parseCatalog({ courses: [{ key: 'a', name: 'A', route: 'r' }, { key: 'a', name: 'B', route: 'r' }] })).toBeNull();
    expect(catalog.parseCatalog({ courses: [{ key: 'a', name: 'A', route: 'r', tags: ['x'], rev: 0, extra: 1 }] })).toEqual([{ key: 'a', name: 'A', route: 'r' }]);
  });
});
