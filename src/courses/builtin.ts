// 기본 코스 (사양서 7.5 기본 코스): 앱에 들어 있는 코스. 폰마다 처음 한 번 코스 목록에 넣는다.
// 코스 번호(id)는 폰마다 새로 만든다. 서버 courses 표는 사람마다 자기 행을 가지므로 모두가 같은 번호를 쓸 수 없다.
// 어느 기본 코스인지는 builtin 키로 안다. 경로 점은 builtinData.ts (처음 넣을 때만 불러오는 따로 나뉜 파일).
import { courseFromGpx } from '../gpx/course';
import type { Course } from '../types/course';

export interface BuiltinCourse {
  key: string;
  name: string;
  /** 어디서 어디로 (목록에 보이는 글) */
  route: string;
}

/** 목록에 보이는 순서 */
export const BUILTIN_COURSES: readonly BuiltinCourse[] = [
  { key: 'baehuryeong', name: '배후령', route: '춘천 → 화천' },
  { key: 'misiryeong-old', name: '미시령 옛길', route: '인제 → 고성' },
  { key: 'manhangjae', name: '만항재', route: '태백 → 만항재 쉼터' },
];

const byKey = new Map(BUILTIN_COURSES.map((b, i) => [b.key, { ...b, rank: i }]));

export function builtinInfo(c: Course): BuiltinCourse | null {
  return (c.builtin && byKey.get(c.builtin)) || null;
}

/** 아직 목록에 없는 기본 코스 */
export function missingBuiltins(courses: readonly Course[]): BuiltinCourse[] {
  const have = new Set(courses.map((c) => c.builtin));
  return BUILTIN_COURSES.filter((b) => !have.has(b.key));
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
  const rank = (c: Course) => (c.builtin ? (byKey.get(c.builtin)?.rank ?? BUILTIN_COURSES.length) : -1);
  return courses
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
}
