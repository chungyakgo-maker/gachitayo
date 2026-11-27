// 지금 쓰는 기본 코스 목록 (2026-11-27 세영 "코스 추가될 때마다 앱 배포 다시 안 하는 방향으로 … 웹 앱 통일"):
// 서버에서 받아 이 폰에 둔 목록, 없으면 앱에 묶인 목록(builtinMeta.ts). 목록 화면·분류·정렬이 모두 여기서 읽는다.
// 받아 둔 목록은 localStorage 에 (점은 빼서 작다 — 점은 코스를 넣을 때 코스 기록 안에 들어간다).
import { BUNDLED_BUILTINS, type BuiltinCourse } from './builtinMeta';

const KEY = 'gachitayo.builtinCatalog.v1';
/** 이 폴더는 브라우저 밖(서버·시험)에서도 묶이므로 localStorage 를 이름으로 바로 쓰지 않는다 */
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
const store = (): Store | undefined => (globalThis as { localStorage?: Store }).localStorage;
const TAGS = new Set(['circuit', 'coast', 'mountain']);

const strs = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

/** 서버가 준 목록을 믿을 수 있는 모양으로 (모르는 칸은 버린다). 하나라도 이상하면 null — 예전 목록을 그대로 쓴다 */
export function parseCatalog(x: unknown): BuiltinCourse[] | null {
  const list = (x as { courses?: unknown } | null)?.courses;
  if (!Array.isArray(list) || list.length === 0) return null;
  const out: BuiltinCourse[] = [];
  const seen = new Set<string>();
  for (const r of list as Array<Record<string, unknown>>) {
    if (!r || typeof r.key !== 'string' || !r.key || typeof r.name !== 'string' || typeof r.route !== 'string' || seen.has(r.key)) return null;
    seen.add(r.key);
    const b: { -readonly [K in keyof BuiltinCourse]: BuiltinCourse[K] } = { key: r.key, name: r.name, route: r.route };
    if (strs(r.desc)) b.desc = r.desc;
    if (strs(r.oldNames)) b.oldNames = r.oldNames;
    if (strs(r.tags) && r.tags.every((t) => TAGS.has(t))) b.tags = r.tags as BuiltinCourse['tags'];
    if (typeof r.rev === 'number' && Number.isInteger(r.rev) && r.rev > 0) b.rev = r.rev;
    out.push(b);
  }
  return out;
}

function loadCached(): BuiltinCourse[] | null {
  try {
    return parseCatalog(JSON.parse(store()?.getItem(KEY) ?? 'null'));
  } catch {
    return null;
  }
}

let list: readonly BuiltinCourse[] = loadCached() ?? BUNDLED_BUILTINS;
let byKey = index(list);
function index(l: readonly BuiltinCourse[]) {
  return new Map(l.map((b, i) => [b.key, { b, rank: i }]));
}

export const builtinCatalog = (): readonly BuiltinCourse[] => list;
export const catalogEntry = (key: string | undefined): BuiltinCourse | undefined => (key ? byKey.get(key)?.b : undefined);
/** 목록 순서 (모르는 키는 맨 뒤) */
export const catalogRank = (key: string): number => byKey.get(key)?.rank ?? list.length;
export const catalogRev = (b: BuiltinCourse): number => b.rev ?? 1;

/** 서버에서 받은 목록으로 바꾸고 이 폰에 둔다. 바뀐 게 있으면 true */
export function setBuiltinCatalog(next: readonly BuiltinCourse[]): boolean {
  const s = JSON.stringify({ courses: next });
  const changed = s !== JSON.stringify({ courses: list });
  list = next;
  byKey = index(next);
  try {
    store()?.setItem(KEY, s);
  } catch {
    // 저장할 수 없어도 이번 실행 동안은 쓴다
  }
  return changed;
}

/** 시험용: 앱에 묶인 목록으로 되돌린다 */
export function resetBuiltinCatalog(): void {
  list = BUNDLED_BUILTINS;
  byKey = index(list);
  try {
    store()?.removeItem(KEY);
  } catch {
    // 없음
  }
}
