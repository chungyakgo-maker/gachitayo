// 즐겨찾기·분류 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md, 사용자 요청 "코스에 즐겨찾기", "분류는 코스마다 직접 고르기"):
// 폰(localStorage)에만 둔다 (기록은 폰에만 2026-11-18: 서버 /api/prefs 와 맞추지 않는다, 폰을 바꿀 땐 백업 파일로). 열쇠는 기본 코스 "b:{key}"(폰을 바꿔도 같다), 내 코스 id.
// 분류는 서킷(circuit)·해안 길(coast)·산 길(mountain). 기본 코스는 따로 정하지 않았으면 산 길 (사용자 결정 "와인딩 없애, 산길로"),
// 서킷 기본 코스는 서킷 (2026-11-27 세영 "코스 리스트에 서킷 카테고리 추가").
import { useSyncExternalStore } from 'react';
import type { Course } from '../types/course';

export type CourseTag = 'circuit' | 'coast' | 'mountain';
export const TAG_LABEL: Record<CourseTag, string> = { circuit: '서킷', coast: '해안 길', mountain: '산 길' };
/** 라벨·칩 순서 */
export const TAGS: CourseTag[] = ['circuit', 'coast', 'mountain'];

/** 산 길이 아닌 기본 코스의 처음 분류 (키 → 분류). 기본 코스 목록(courses/builtin.ts)을 여기서 불러오지 않으려고 따로 둔다 */
const BUILTIN_TAGS: Record<string, CourseTag[]> = { 'inje-speedium': ['circuit'] };

export interface CoursePrefs {
  favorites: string[];
  tags: Record<string, CourseTag[]>;
}

const KEY = 'gachitayo.coursePrefs.v1';

/** 열쇠: 기본 코스 b:{key}, 받은 모두의 코스 s:{공개 번호} (폰을 바꾸거나 다시 받아도 같다), 내 코스 id */
export const prefKey = (c: Pick<Course, 'id' | 'builtin' | 'shared'>): string => (c.builtin ? `b:${c.builtin}` : c.shared ? `s:${c.shared.id}` : c.id);

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

/** 백업 파일의 즐겨찾기·분류를 합친다: 즐겨찾기는 둘 다, 분류는 이 폰에서 정한 것이 이긴다 */
export function mergeCoursePrefs(p: CoursePrefs): void {
  set({ favorites: [...prefs.favorites, ...p.favorites.filter((k) => !prefs.favorites.includes(k))], tags: { ...p.tags, ...prefs.tags } });
}

export const getCoursePrefs = (): CoursePrefs => prefs;
export function useCoursePrefs(): CoursePrefs {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getCoursePrefs);
}

export const isFavorite = (c: Pick<Course, 'id' | 'builtin' | 'shared'>, p: CoursePrefs = prefs): boolean => p.favorites.includes(prefKey(c));

export function toggleFavorite(c: Pick<Course, 'id' | 'builtin' | 'shared'>): void {
  const k = prefKey(c);
  const favorites = prefs.favorites.includes(k) ? prefs.favorites.filter((x) => x !== k) : [...prefs.favorites, k];
  set({ ...prefs, favorites });
}

export function tagsOf(c: Pick<Course, 'id' | 'builtin' | 'shared'>, p: CoursePrefs = prefs): CourseTag[] {
  const t = p.tags[prefKey(c)];
  if (t) return t;
  return c.builtin ? (BUILTIN_TAGS[c.builtin] ?? ['mountain']) : [];
}

export function setTag(c: Pick<Course, 'id' | 'builtin' | 'shared'>, tag: CourseTag, on: boolean): void {
  const cur = tagsOf(c);
  const next = on ? TAGS.filter((t) => t === tag || cur.includes(t)) : cur.filter((t) => t !== tag);
  set({ ...prefs, tags: { ...prefs.tags, [prefKey(c)]: next } });
}
