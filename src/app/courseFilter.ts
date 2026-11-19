// 코스 분류 칩 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md): 메인 지도와 코스 목록이 같이 쓴다
import type { Course } from '../types/course';
import type { CourseTag } from './coursePrefs';

export type CourseFilter = 'all' | 'builtin' | 'fav' | 'mine' | 'coast' | 'mountain' | 'popular';
export type PopularPeriod = 'live' | '7d' | '30d' | 'all' | 'spring' | 'summer' | 'autumn' | 'winter';

export const FILTERS: Array<{ id: CourseFilter; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'builtin', label: '기본 코스' },
  { id: 'fav', label: '즐겨찾기' },
  { id: 'mine', label: '내 코스' },
  { id: 'coast', label: '해안 길' },
  { id: 'mountain', label: '산 길' },
  { id: 'popular', label: '인기 도로' },
];

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
      case 'fav':
        return p.isFavorite(c);
      case 'mine':
        return !c.builtin;
      case 'coast':
      case 'mountain':
        return p.tagsOf(c).includes(f);
      default:
        return true;
    }
  };
  return courses.filter(keep).map((course) => ({ course }));
}
