// 인기 도로 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md): 기본 코스별 달린 사람 수. 기간마다 1분 동안 다시 묻지 않는다
import { useEffect, useState } from 'react';
import { apiFetch } from '../server/api';
import { getAuth } from './account';
import type { PopularPeriod } from './courseFilter';

export type PopularRow = { builtin: string; drivers: number };
const CACHE_MS = 60_000;
const cache = new Map<PopularPeriod, { at: number; rows: PopularRow[] }>();

export async function fetchPopular(period: PopularPeriod, now = Date.now()): Promise<PopularRow[]> {
  const hit = cache.get(period);
  if (hit && now - hit.at < CACHE_MS) return hit.rows;
  const auth = getAuth();
  if (!auth) throw new Error('계정이 있어야 인기 도로를 볼 수 있어요');
  const rows = await apiFetch<PopularRow[]>('GET', `/api/popular?period=${period}`, { token: auth.token });
  cache.set(period, { at: now, rows });
  return rows;
}

/** 인기 도로를 고른 동안만 불러온다 */
export function usePopular(period: PopularPeriod, enabled: boolean): { rows: PopularRow[] | null; error: string | null } {
  const [state, setState] = useState<{ key: string; rows: PopularRow[] | null; error: string | null }>({ key: '', rows: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchPopular(period).then(
      (rows) => alive && setState({ key: period, rows, error: null }),
      (e: unknown) => alive && setState({ key: period, rows: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [period, enabled]);
  return state.key === period ? { rows: state.rows, error: state.error } : { rows: null, error: null };
}
