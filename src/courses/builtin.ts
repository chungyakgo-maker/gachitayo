// 기본 코스 (사양서 7.5 기본 코스): 앱에 들어 있는 코스. 폰마다 처음 한 번 코스 목록에 넣는다.
// 코스 번호(id)는 폰마다 새로 만든다. 서버 courses 표는 사람마다 자기 행을 가지므로 모두가 같은 번호를 쓸 수 없다.
// 어느 기본 코스인지는 builtin 키로 안다. 경로 점은 builtinData.ts (처음 넣을 때만 불러오는 따로 나뉜 파일).
import { courseFromGpx } from '../gpx/course';
import type { Course } from '../types/course';
import { BUNDLED_BUILTINS, type BuiltinCourse } from './builtinMeta';
import { builtinCatalog, catalogEntry, catalogRank } from './catalog';

export type { BuiltinCourse } from './builtinMeta';

/** 앱에 묶인 목록 (시험·되살리기 이름 비교용). 화면은 지금 목록(catalog — 서버에서 받은 것)을 쓴다 */
export const BUILTIN_COURSES: readonly BuiltinCourse[] = BUNDLED_BUILTINS;

export function builtinInfo(c: Course): BuiltinCourse | null {
  return catalogEntry(c.builtin) ?? null;
}

/** 아직 목록에 없는 기본 코스 */
export function missingBuiltins(courses: readonly Course[]): BuiltinCourse[] {
  const have = new Set(courses.map((c) => c.builtin));
  return builtinCatalog().filter((b) => !have.has(b.key));
}

/** 폰에 예전 기본 이름으로 들어 있는 기본 코스 → 새 이름으로 바꾼 코스 (바꿀 것만) */
export function renamedBuiltins(courses: readonly Course[]): Course[] {
  const out: Course[] = [];
  for (const c of courses) {
    const b = catalogEntry(c.builtin);
    if (b && c.name !== b.name && b.oldNames?.includes(c.name)) out.push({ ...c, name: b.name });
  }
  return out;
}

/** 경로 점 [위도, 경도, …] → 코스. GPX 불러오기와 같은 방법(평활, 1 m 재샘플, 양 끝에 출발·도착선) */
export function builtinCourse(b: BuiltinCourse, points: readonly number[], opts: { id: string; gateWidthM: number }): Course {
  const pts = [];
  for (let i = 0; i + 1 < points.length; i += 2) pts.push({ lat: points[i]!, lon: points[i + 1]!, ele: null, time: null, speed: null });
  const c = courseFromGpx({ name: b.name, creator: 'kakaomap-route', points: pts, hasTime: false, source: 'trk', waypoints: [] }, { id: opts.id, name: b.name });
  const w = opts.gateWidthM;
  return { ...c, builtin: b.key, startGate: { ...c.startGate, widthM: w }, finishGate: { ...c.finishGate, widthM: w } };
}

/** 내 코스 먼저 (원래 순서), 그다음 기본 코스 (정한 순서) */
export function sortCourses(courses: readonly Course[]): Course[] {
  const rank = (c: Course) => (c.builtin ? catalogRank(c.builtin) : -1);
  return courses
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
}
