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

/** 한 번에 하나만 올린다 (늦게 도착한 예전 것이 새것을 덮지 않게, 검토 지적). 올리는 중에 또 바뀌면 끝난 뒤 한 번 더 */
let uploading: Promise<void> | null = null;
let again = false;

function upload(): Promise<void> {
  if (uploading) {
    again = true;
    return uploading;
  }
  uploading = (async () => {
    do {
      again = false;
      const auth = getAuth();
      if (!auth || !dirty) break;
      const sent = prefs;
      try {
        await apiFetch('PUT', '/api/prefs', { token: auth.token, body: sent });
        if (sent === prefs) {
          dirty = false;
          saveLocal();
        }
      } catch {
        // 다음 변경이나 다음 맞추기 때 다시 올린다
        break;
      }
    } while (again);
  })().finally(() => {
    uploading = null;
  });
  return uploading;
}

const union = <T,>(a: T[], b: T[]): T[] => [...a, ...b.filter((x) => !a.includes(x))];

/**
 * 계정과 맞춘다 (앱 시작·계정 바뀜). 여기서 바꾼 게 남아 있으면 올리고, 아니면 서버 것을 받는다.
 * 계정이 바뀌었으면(카카오 로그인·계정 합치기) 둘 다 살린다: 서버 것과 이 폰 것을 합쳐 올린다 (검토 지적: 별이 사라졌다)
 */
export async function syncCoursePrefs(opts: { accountChanged?: boolean } = {}): Promise<void> {
  const auth = getAuth();
  if (!auth) return;
  if (dirty && !opts.accountChanged) return upload();
  try {
    const p = await apiFetch<CoursePrefs>('GET', '/api/prefs', { token: auth.token });
    const server: CoursePrefs = { favorites: p.favorites ?? [], tags: p.tags ?? {} };
    if (opts.accountChanged) {
      const merged: CoursePrefs = { favorites: union(server.favorites, prefs.favorites), tags: { ...prefs.tags, ...server.tags } };
      const same = merged.favorites.length === server.favorites.length && Object.keys(merged.tags).length === Object.keys(server.tags).length;
      set(merged, !same);
      if (!same) {
        if (timer) clearTimeout(timer);
        await upload();
      }
      return;
    }
    if (!dirty) set(server, false);
  } catch {
    // 통신이 안 되면 폰에 있는 것으로
  }
}

/** 이 폰에 둔 것을 지운다 (로그아웃: 다음 계정으로 옮겨 가지 않게) */
export function clearCoursePrefs(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  prefs = { favorites: [], tags: {} };
  dirty = false;
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
