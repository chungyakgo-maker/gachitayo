// 즐겨찾기·분류 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md): 폰에만 둔다 (기록은 폰에만 4단계 — 서버와 맞추지 않는다)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '../../src/types/course';

const h = vi.hoisted(() => ({ auth: { userId: 'u1', token: 'tok' } as { userId: string; token: string } | null }));
vi.mock('../../src/app/account', () => ({ getAuth: () => h.auth, subscribeAccount: () => () => {} }));

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const storage = new MemoryStorage();
const calls: Array<{ method: string; url: string; body: unknown }> = [];
let serverPrefs: unknown = { favorites: [], tags: {} };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  storage.clear();
  calls.length = 0;
  serverPrefs = { favorites: [], tags: {} };
  h.auth = { userId: 'u1', token: 'tok' };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: init.method ?? 'GET', url, body });
      if (init.method === 'PUT') {
        serverPrefs = body;
        return json(200, body);
      }
      return json(200, serverPrefs);
    }),
  );
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});
const load = () => import('../../src/app/coursePrefs');
const builtin = { id: 'x1', builtin: 'haogogae' } as Course;
const mine = { id: 'c-123', builtin: null } as unknown as Course;

describe('coursePrefs', () => {
  it('keys built-in courses by key and own courses by id', async () => {
    const p = await load();
    expect(p.prefKey(builtin)).toBe('b:haogogae');
    expect(p.prefKey(mine)).toBe('c-123');
  });

  it('built-in courses are mountain roads until changed; own courses have no tag', async () => {
    const p = await load();
    expect(p.tagsOf(builtin)).toEqual(['mountain']);
    expect(p.tagsOf(mine)).toEqual([]);
    p.setTag(builtin, 'mountain', false);
    p.setTag(builtin, 'coast', true);
    expect(p.tagsOf(builtin)).toEqual(['coast']);
  });

  it('favorite toggles and persists on the phone only (never calls the server)', async () => {
    const p = await load();
    p.toggleFavorite(mine);
    expect(p.isFavorite(mine)).toBe(true);
    expect(JSON.parse(storage.getItem('gachitayo.coursePrefs.v1')!).prefs.favorites).toEqual(['c-123']);
    p.setTag(mine, 'coast', true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(0);
    p.toggleFavorite(mine);
    expect(p.isFavorite(mine)).toBe(false);
  });

  it('reads what an older app saved on this phone (prefs with a dirty flag)', async () => {
    storage.setItem('gachitayo.coursePrefs.v1', JSON.stringify({ prefs: { favorites: ['b:haogogae'], tags: { 'c-123': ['coast'] } }, dirty: true }));
    const p = await load();
    expect(p.isFavorite(builtin)).toBe(true);
    expect(p.tagsOf(mine)).toEqual(['coast']);
    expect(calls).toHaveLength(0);
  });

  it('clearCoursePrefs forgets this phone copy (logout)', async () => {
    const p = await load();
    p.toggleFavorite(mine);
    p.clearCoursePrefs();
    expect(p.isFavorite(mine)).toBe(false);
    expect(storage.getItem('gachitayo.coursePrefs.v1')).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);
  });

});
