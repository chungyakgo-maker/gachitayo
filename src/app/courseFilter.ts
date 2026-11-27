// 코스 분류 칩 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md): 메인 지도와 코스 목록이 같이 쓴다
import type { Course } from '../types/course';
import type { CourseTag } from './coursePrefs';

export type CourseFilter = 'all' | 'builtin' | 'shared' | 'fav' | 'mine' | 'circuit' | 'coast' | 'mountain' | 'popular';
export type PopularPeriod = 'live' | '7d' | '30d' | 'all' | 'spring' | 'summer' | 'autumn' | 'winter';

export const FILTERS: Array<{ id: CourseFilter; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'builtin', label: '기본 코스' },
  // 모두의 코스 (설계 2부, 시안 ⑦): 코스 탭은 서버 목록, 다른 곳은 받아 둔 코스
  { id: 'shared', label: '모두의 코스' },
  { id: 'fav', label: '즐겨찾기' },
  { id: 'mine', label: '내 코스' },
  // 2026-11-27 세영 "코스 리스트에 서킷 카테고리 추가"
  { id: 'circuit', label: '서킷' },
  { id: 'coast', label: '해안 길' },
  { id: 'mountain', label: '산 길' },
  { id: 'popular', label: '인기 도로' },
];

/** 코스 줄 라벨과 같은 색 점을 칩 앞에 찍는다 (2026-11-27 세영 "코스별 컬러라벨을 다르게", 시안 docs/mock/2026-11-27-course-search.jpg).
 *  값은 styles.css 의 색 이름 (src-* · tag-*) */
export const FILTER_DOT: Partial<Record<CourseFilter, string>> = {
  builtin: 'src-builtin',
  shared: 'src-shared',
  mine: 'src-mine',
  circuit: 'tag-circuit',
  coast: 'tag-coast',
  mountain: 'tag-mountain',
};

/** 코스 줄의 출처 라벨: 기본 코스 · 받아 둔 모두의 코스 · 내 코스 */
export function courseSource(c: Pick<Course, 'builtin' | 'shared'>): { cls: string; label: string } {
  if (c.builtin) return { cls: 'src-builtin', label: '기본 코스' };
  if (c.shared) return { cls: 'src-shared', label: '모두의 코스' };
  return { cls: 'src-mine', label: '내 코스' };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** 코스 검색 (2026-11-27 세영 "등록된 코스를 텍스트로 검색"): 이름과 어디서 어디로 글에서, 대소문자·띄어쓰기 상관없이. 빈 글이면 그대로 */
export function searchCourses<T extends { course: Course }>(rows: T[], query: string, routeOf: (c: Course) => string | undefined): T[] {
  const q = norm(query);
  if (!q) return rows;
  return rows.filter(({ course }) => norm(course.name).includes(q) || norm(routeOf(course) ?? '').includes(q));
}

export const PERIODS: Array<{ id: PopularPeriod; label: string }> = [
  { id: 'live', label: '실시간' },
  { id: '7d', label: '7일' },
  { id: '30d', label: '30일' },
  { id: 'all', label: '전체' },
  { id: 'spring', label: '봄' },
  { id: 'summer', label: '여름' },
  { id: 'autumn', label: '가을' },
  { id: 'winter', label: '겨울' },
];

export interface FilterPrefs {
  isFavorite: (c: Course) => boolean;
  tagsOf: (c: Course) => CourseTag[];
}

export function filterCourses(courses: Course[], f: CourseFilter, p: FilterPrefs, popular: ReadonlyArray<{ builtin: string; drivers: number }> | null): Array<{ course: Course; drivers?: number }> {
  if (f === 'popular') {
    if (!popular) return [];
    const out: Array<{ course: Course; drivers: number }> = [];
    for (const r of popular) {
      // 모두의 코스는 's:{공개 번호}' 로 온다 (폰에 받아 둔 것만 보인다)
      const course = courses.find((c) => (r.builtin.startsWith('s:') ? c.shared?.id === r.builtin.slice(2) : c.builtin === r.builtin));
      if (course && r.drivers > 0) out.push({ course, drivers: r.drivers });
    }
    return out;
  }
  const keep = (c: Course): boolean => {
    switch (f) {
      case 'builtin':
        return !!c.builtin;
      case 'shared':
        return !!c.shared;
      case 'fav':
        return p.isFavorite(c);
      case 'mine':
        return !c.builtin;
      case 'circuit':
      case 'coast':
      case 'mountain':
        return p.tagsOf(c).includes(f);
      default:
        return true;
    }
  };
  return courses.filter(keep).map((course) => ({ course }));
}
