// 즐겨찾기·분류 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md, 사용자 요청 "코스에 즐겨찾기", "분류는 코스마다 직접 고르기"):
// 폰(localStorage)에 두고 계정(/api/prefs)과 맞춘다. 열쇠는 기본 코스 "b:{key}"(폰을 바꿔도 같다), 내 코스 id.
// 분류는 해안 길(coast)·산 길(mountain). 기본 코스는 따로 정하지 않았으면 산 길 (사용자 결정 "와인딩 없애, 산길로").
import { useSyncExternalStore } from 'react';
import { apiFetch } from '../server/api';
import type { Course } from '../types/course';
import { getAuth } from './account';

export type CourseTag = 'coast' | 'mountain';
export const TAG_LABEL: Record<CourseTag, string> = { coast: '해안 길', mountain: '산 길' };
export const TAGS: CourseTag[] = ['coast', 'mountain'];

export interface CoursePrefs {
  favorites: string[];
  tags: Record<string, CourseTag[]>;
}

const KEY = 'gachitayo.coursePrefs.v1';
const UPLOAD_DELAY_MS = 800;

export const prefKey = (c: Pick<Course, 'id' | 'builtin'>): string => (c.builtin ? `b:${c.builtin}` : c.id);

function loadLocal(): { prefs: CoursePrefs; dirty: boolean } {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { prefs?: CoursePrefs; dirty?: boolean } | null;
    if (o?.prefs && Array.isArray(o.prefs.favorites) && o.prefs.tags && typeof o.prefs.tags === 'object') return { prefs: o.prefs, dirty: o.dirty === true };
  } catch {
    // 못 읽으면 빈 값
  }
  return { prefs: { favorites: [], tags: {} }, dirty: false };
}

let { prefs, dirty } = loadLocal();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function saveLocal(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ prefs, dirty }));
  } catch {
    // 저장할 수 없어도 이번 실행 동안은 쓴다
  }
}

function set(next: CoursePrefs, changedHere: boolean): void {
  prefs = next;
  if (changedHere) dirty = true;
  saveLocal();
  listeners.forEach((l) => l());
  if (changedHere) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void upload(), UPLOAD_DELAY_MS);
  }
}

async function upload(): Promise<void> {
  const auth = getAuth();
  if (!auth || !dirty) return;
  const sent = prefs;
  try {
    await apiFetch('PUT', '/api/prefs', { token: auth.token, body: sent });
    if (sent === prefs) {
      dirty = false;
      saveLocal();
    }
  } catch {
    // 다음 변경이나 다음 맞추기 때 다시 올린다
  }
}

/** 계정과 맞춘다: 여기서 바꾼 게 남아 있으면 올리고, 아니면 서버 것을 받는다 (앱 시작·계정 바뀜) */
export async function syncCoursePrefs(): Promise<void> {
  const auth = getAuth();
  if (!auth) return;
  if (dirty) return upload();
  try {
    const p = await apiFetch<CoursePrefs>('GET', '/api/prefs', { token: auth.token });
    if (!dirty) set({ favorites: p.favorites ?? [], tags: p.tags ?? {} }, false);
  } catch {
    // 통신이 안 되면 폰에 있는 것으로
  }
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
  set({ ...prefs, favorites }, true);
}

export function tagsOf(c: Pick<Course, 'id' | 'builtin'>, p: CoursePrefs = prefs): CourseTag[] {
  const t = p.tags[prefKey(c)];
  if (t) return t;
  return c.builtin ? ['mountain'] : [];
}

export function setTag(c: Pick<Course, 'id' | 'builtin'>, tag: CourseTag, on: boolean): void {
  const cur = tagsOf(c);
  const next = on ? TAGS.filter((t) => t === tag || cur.includes(t)) : cur.filter((t) => t !== tag);
  set({ ...prefs, tags: { ...prefs.tags, [prefKey(c)]: next } }, true);
}
