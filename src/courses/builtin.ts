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
  /** 예전 기본 이름. 폰에 이 이름으로 들어 있으면 새 이름으로 바꾼다 (사용자가 직접 바꾼 이름은 그대로) */
  oldNames?: readonly string[];
}

/** 목록에 보이는 순서 */
export const BUILTIN_COURSES: readonly BuiltinCourse[] = [
  { key: 'baehuryeong', name: '배후령', route: '춘천 → 화천' },
  { key: 'misiryeong-old', name: '미시령 옛길', route: '인제 → 고성' },
  { key: 'manhangjae', name: '만항재', route: '태백 → 만항재 쉼터' },
  { key: 'maltijae', name: '말티재', route: '보은 → 말티재 전망대' },
  { key: 'guryongnyeong', name: '구룡령', route: '홍천 → 양양' },
  { key: 'gapyeong-bokjang-sangcheon', name: '로코갤러리', route: '가평읍 → 청평면', oldNames: ['가평 복장리–상천리'] },
  { key: 'haogogae', name: '하오고개', route: '의왕 청계 → 분당 운중' },
  { key: 'bukak-skyway', name: '북악스카이웨이', route: '부암동 → 정릉' },
  { key: 'namhansanseong', name: '남한산성', route: '성남 산성동 → 남한산성' },
  { key: 'jinbu-myeon', name: '진부면', route: '진부 → 숙암' },
  { key: 'pyeonghwa-dam', name: '평화의댐', route: '화천 → 양구' },
  // 사용자가 준 카카오맵 GPX (2026-11-13 두 번째). 이름 셋(팔공산 한티재·신동재·미륵고개전망대)은 사용자가 알려 줌, 둘은 GPX 도착지 이름
  { key: 'gunwi-namsan-chilgok-giseong', name: '팔공산 한티재', route: '군위 부계면 → 칠곡 동명면' },
  { key: 'chilgok-yeonho-deoksan', name: '신동재', route: '칠곡 지천면 연호리 → 덕산리' },
  { key: 'hambaek-mungok', name: '미륵고개전망대', route: '함백역 → 정선 남면 문곡리' },
  { key: 'maebongsan-baramui-eondeok', name: '매봉산 바람의언덕', route: '태백 적각동 → 매봉산 바람의언덕' },
  { key: 'jeoksangsan-observatory', name: '적상산전망대', route: '무주 적상면 북창리 → 적상산전망대' },
  // 사용자가 준 카카오맵 GPX (2026-11-14). 이름은 GPX에 적힌 곳 이름 (사용자가 바꾸면 oldNames로 옮긴다)
  { key: 'sukam-bukpyeong', name: '숙암리–북평리', route: '정선 북평면 숙암리 → 북평리' },
];

/** 기본 코스 선 고침 차례. 폰에 기록한 차례보다 크면 앱 시작 때 한 번, 예전 선으로 들어 있는 기본 코스를 새 선으로 바꾼다.
 *  2: 카카오맵 경로 끝 진입로를 건너뛰고 출발·도착선을 도로 방향으로 (사용자 요청 "북악 출발선 고쳐") */
export const BUILTIN_REV = 2;

const byKey = new Map(BUILTIN_COURSES.map((b, i) => [b.key, { ...b, rank: i }]));

export function builtinInfo(c: Course): BuiltinCourse | null {
  return (c.builtin && byKey.get(c.builtin)) || null;
}

/** 아직 목록에 없는 기본 코스 */
export function missingBuiltins(courses: readonly Course[]): BuiltinCourse[] {
  const have = new Set(courses.map((c) => c.builtin));
  return BUILTIN_COURSES.filter((b) => !have.has(b.key));
}

/** 폰에 예전 기본 이름으로 들어 있는 기본 코스 → 새 이름으로 바꾼 코스 (바꿀 것만) */
export function renamedBuiltins(courses: readonly Course[]): Course[] {
  const out: Course[] = [];
  for (const c of courses) {
    const b = c.builtin ? byKey.get(c.builtin) : undefined;
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
  const rank = (c: Course) => (c.builtin ? (byKey.get(c.builtin)?.rank ?? BUILTIN_COURSES.length) : -1);
  return courses
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
}
