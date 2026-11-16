// 즐겨찾기·분류 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md): 폰에 두고 계정과 맞춘다
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

  it('favorite toggles, persists on the phone and uploads after a pause', async () => {
    const p = await load();
    p.toggleFavorite(mine);
    expect(p.isFavorite(mine)).toBe(true);
    expect(JSON.parse(storage.getItem('gachitayo.coursePrefs.v1')!).prefs.favorites).toEqual(['c-123']);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([{ method: 'PUT', url: expect.stringMatching(/\/api\/prefs$/), body: { favorites: ['c-123'], tags: {} } }]);
    p.toggleFavorite(mine);
    expect(p.isFavorite(mine)).toBe(false);
  });

  it('sync takes the server copy when nothing changed here', async () => {
    serverPrefs = { favorites: ['b:haogogae'], tags: { 'c-123': ['coast'] } };
    const p = await load();
    await p.syncCoursePrefs();
    expect(p.isFavorite(builtin)).toBe(true);
    expect(p.tagsOf(mine)).toEqual(['coast']);
  });

  it('account change keeps both: local and server favorites are merged and uploaded', async () => {
    const p = await load();
    p.toggleFavorite(mine);
    await vi.advanceTimersByTimeAsync(1000);
    serverPrefs = { favorites: ['b:haogogae'], tags: { 'b:haogogae': ['coast'] } };
    calls.length = 0;
    await p.syncCoursePrefs({ accountChanged: true });
    expect(p.isFavorite(mine)).toBe(true);
    expect(p.isFavorite(builtin)).toBe(true);
    expect(p.tagsOf(builtin)).toEqual(['coast']);
    expect(calls.at(-1)).toEqual({ method: 'PUT', url: expect.stringMatching(/\/api\/prefs$/), body: { favorites: ['b:haogogae', 'c-123'], tags: { 'b:haogogae': ['coast'] } } });
  });

  it('only one upload at a time; the newest copy wins', async () => {
    const p = await load();
    let release: (() => void) | null = null;
    const order: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        order.push(JSON.parse(String(init.body)).favorites);
        if (!release) await new Promise<void>((r) => (release = r));
        return json(200, {});
      }),
    );
    p.toggleFavorite(mine);
    await vi.advanceTimersByTimeAsync(1000);
    p.toggleFavorite(builtin);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual([['c-123']]);
    release!();
    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual([['c-123'], ['c-123', 'b:haogogae']]);
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

  it('sync uploads changes made while offline', async () => {
    h.auth = null;
    const p = await load();
    p.toggleFavorite(builtin);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);
    h.auth = { userId: 'u1', token: 'tok' };
    serverPrefs = { favorites: [], tags: {} };
    await p.syncCoursePrefs();
    expect(calls.at(-1)).toEqual({ method: 'PUT', url: expect.stringMatching(/\/api\/prefs$/), body: { favorites: ['b:haogogae'], tags: {} } });
    expect(p.isFavorite(builtin)).toBe(true);
  });
});
