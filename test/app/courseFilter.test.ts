// 코스 분류 칩 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md)
import { describe, expect, it } from 'vitest';
import { filterCourses, FILTERS } from '../../src/app/courseFilter';
import type { Course } from '../../src/types/course';

const c = (id: string, builtin: string | null) => ({ id, name: id, builtin }) as unknown as Course;
const hao = c('hao', 'haogogae');
const nam = c('nam', 'namhansanseong');
const mineA = c('mine-a', null);
const mineB = c('mine-b', null);
const all = [hao, nam, mineA, mineB];
const fav = new Set(['b:haogogae', 'mine-b']);
const prefs = {
  isFavorite: (x: Course) => fav.has(x.builtin ? `b:${x.builtin}` : x.id),
  tagsOf: (x: Course) => (x.id === 'mine-a' ? ['coast' as const] : x.builtin ? ['mountain' as const] : []),
};
const ids = (r: Array<{ course: Course }>) => r.map((x) => x.course.id);

describe('filterCourses', () => {
  it('chip labels in order', () => {
    expect(FILTERS.map((f) => f.label)).toEqual(['전체', '기본 코스', '즐겨찾기', '내 코스', '해안 길', '산 길', '인기 도로']);
  });
  it('all, built-in, favorites, mine', () => {
    expect(ids(filterCourses(all, 'all', prefs, null))).toEqual(['hao', 'nam', 'mine-a', 'mine-b']);
    expect(ids(filterCourses(all, 'builtin', prefs, null))).toEqual(['hao', 'nam']);
    expect(ids(filterCourses(all, 'fav', prefs, null))).toEqual(['hao', 'mine-b']);
    expect(ids(filterCourses(all, 'mine', prefs, null))).toEqual(['mine-a', 'mine-b']);
  });
  it('tags', () => {
    expect(ids(filterCourses(all, 'coast', prefs, null))).toEqual(['mine-a']);
    expect(ids(filterCourses(all, 'mountain', prefs, null))).toEqual(['hao', 'nam']);
  });
  it('popular: built-in courses with drivers, most first, with counts', () => {
    const r = filterCourses(all, 'popular', prefs, [
      { builtin: 'namhansanseong', drivers: 5 },
      { builtin: 'haogogae', drivers: 2 },
      { builtin: 'unknown', drivers: 9 },
    ]);
    expect(r.map((x) => [x.course.id, x.drivers])).toEqual([
      ['nam', 5],
      ['hao', 2],
    ]);
    expect(filterCourses(all, 'popular', prefs, null)).toEqual([]);
  });
});
