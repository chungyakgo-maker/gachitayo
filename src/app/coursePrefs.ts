// 즐겨찾기·분류 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md, 사용자 요청 "코스에 즐겨찾기", "분류는 코스마다 직접 고르기"):
// 폰(localStorage)에만 둔다 (기록은 폰에만 2026-11-18: 서버 /api/prefs 와 맞추지 않는다, 폰을 바꿀 땐 백업 파일로). 열쇠는 기본 코스 "b:{key}"(폰을 바꿔도 같다), 내 코스 id.
// 분류는 해안 길(coast)·산 길(mountain). 기본 코스는 따로 정하지 않았으면 산 길 (사용자 결정 "와인딩 없애, 산길로").
import { useSyncExternalStore } from 'react';
import type { Course } from '../types/course';

export type CourseTag = 'coast' | 'mountain';
export const TAG_LABEL: Record<CourseTag, string> = { coast: '해안 길', mountain: '산 길' };
export const TAGS: CourseTag[] = ['coast', 'mountain'];

export interface CoursePrefs {
  favorites: string[];
  tags: Record<string, CourseTag[]>;
}

const KEY = 'gachitayo.coursePrefs.v1';

export const prefKey = (c: Pick<Course, 'id' | 'builtin'>): string => (c.builtin ? `b:${c.builtin}` : c.id);

function loadLocal(): CoursePrefs {
  try {
    // 예전 앱은 { prefs, dirty } 로 저장했다 (dirty 는 이제 안 쓴다)
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { prefs?: CoursePrefs } | null;
    if (o?.prefs && Array.isArray(o.prefs.favorites) && o.prefs.tags && typeof o.prefs.tags === 'object') return o.prefs;
  } catch {
    // 못 읽으면 빈 값
  }
  return { favorites: [], tags: {} };
}

let prefs = loadLocal();
const listeners = new Set<() => void>();

function set(next: CoursePrefs): void {
  prefs = next;
  try {
    localStorage.setItem(KEY, JSON.stringify({ prefs }));
  } catch {
    // 저장할 수 없어도 이번 실행 동안은 쓴다
  }
  listeners.forEach((l) => l());
}

/** 이 폰에 둔 것을 지운다 (로그아웃: 다음 계정으로 옮겨 가지 않게) */
export function clearCoursePrefs(): void {
  prefs = { favorites: [], tags: {} };
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 지울 수 없어도 이번 실행에서는 비었다
  }
  listeners.forEach((l) => l());
}

export const getCoursePrefs = (): CoursePrefs => prefs;
export function useCoursePrefs(): CoursePrefs {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getCoursePrefs);
}

export const isFavorite = (c: Pick<Course, 'id' | 'builtin'>, p: CoursePrefs = prefs): boolean => p.favorites.includes(prefKey(c));

export function toggleFavorite(c: Pick<Course, 'id' | 'builtin'>): void {
  const k = prefKey(c);
  const favorites = prefs.favorites.includes(k) ? prefs.favorites.filter((x) => x !== k) : [...prefs.favorites, k];
  set({ ...prefs, favorites });
}

export function tagsOf(c: Pick<Course, 'id' | 'builtin'>, p: CoursePrefs = prefs): CourseTag[] {
  const t = p.tags[prefKey(c)];
  if (t) return t;
  return c.builtin ? ['mountain'] : [];
}

export function setTag(c: Pick<Course, 'id' | 'builtin'>, tag: CourseTag, on: boolean): void {
  const cur = tagsOf(c);
  const next = on ? TAGS.filter((t) => t === tag || cur.includes(t)) : cur.filter((t) => t !== tag);
  set({ ...prefs, tags: { ...prefs.tags, [prefKey(c)]: next } });
}
