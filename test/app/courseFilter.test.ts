// 코스 분류 칩 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md)
import { describe, expect, it } from 'vitest';
import { filterCourses, FILTERS, FILTER_DOT, searchCourses } from '../../src/app/courseFilter';
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

// 2026-11-27 세영 "코스리스트에 코스 검색창 … 등록된 코스를 텍스트로 검색"
describe('searchCourses', () => {
  const route = (x: Course) => (x.id === 'hao' ? '의왕 청계 → 분당 운중' : x.id === 'nam' ? '성남 산성동 → 남한산성' : undefined);
  const rows = [hao, nam, mineA].map((course) => ({ course }));
  it('empty query keeps everything', () => {
    expect(ids(searchCourses(rows, '  ', route))).toEqual(['hao', 'nam', 'mine-a']);
  });
  it('matches name or route, ignoring case and spaces', () => {
    expect(ids(searchCourses(rows, '성남', route))).toEqual(['nam']);
    expect(ids(searchCourses(rows, '분당운중', route))).toEqual(['hao']);
    expect(ids(searchCourses(rows, 'MINE', route))).toEqual(['mine-a']);
    expect(ids(searchCourses(rows, '없는길', route))).toEqual([]);
  });
});

describe('filterCourses', () => {
  it('chip labels in order', () => {
    expect(FILTERS.map((f) => f.label)).toEqual(['전체', '기본 코스', '모두의 코스', '즐겨찾기', '내 코스', '서킷', '해안 길', '산 길', '인기 도로']);
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
  // 2026-11-27 세영 "코스 리스트에 서킷 카테고리 추가" (시안 docs/mock/2026-11-27-course-search.jpg)
  it('circuit chip keeps circuit-tagged courses', () => {
    const p2 = { ...prefs, tagsOf: (x: Course) => (x.id === 'nam' ? ['circuit' as const] : prefs.tagsOf(x)) };
    expect(ids(filterCourses(all, 'circuit', p2, null))).toEqual(['nam']);
  });
  it('chips with a matching row label carry its colour dot', () => {
    expect(FILTERS.filter((f) => FILTER_DOT[f.id]).map((f) => f.id)).toEqual(['builtin', 'shared', 'mine', 'circuit', 'coast', 'mountain']);
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
