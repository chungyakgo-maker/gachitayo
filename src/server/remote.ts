// 업로드 대상: Supabase 표 + 파일 게이트웨이 (사양서 6.5, 6.6)
import type { Remote } from '../sync/syncEngine';
import { serverConfig } from './config';
import { getSupabase } from './supabase';

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function createRemote(): Remote {
  const files = serverConfig.filesUrl;
  return {
    async userId() {
      const { data } = await (await getSupabase()).auth.getSession();
      return data.session?.user.id ?? null;
    },
    async token() {
      const { data } = await (await getSupabase()).auth.getSession();
      return data.session?.access_token ?? null;
    },
    async upsertCourse(row) {
      check((await (await getSupabase()).from('courses').upsert(row, { onConflict: 'id' })).error, '코스 저장');
    },
    async upsertSession(row) {
      check((await (await getSupabase()).from('sessions').upsert(row, { onConflict: 'id' })).error, '세션 저장');
    },
    async upsertLaps(rows) {
      check((await (await getSupabase()).from('laps').upsert(rows, { onConflict: 'session_id,lap_no' })).error, '랩 저장');
    },
    async deleteLapsAbove(sessionId, maxLapNo) {
      check((await (await getSupabase()).from('laps').delete().eq('session_id', sessionId).gt('lap_no', maxLapNo)).error, '랩 정리');
    },
    async putFile(key, bytes, token) {
      const r = await fetch(`${files}/files/${key}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' },
        body: bytes,
      });
      if (!r.ok) throw new Error(`파일 업로드 실패 (${r.status})`);
    },
    async headFile(key, token) {
      const r = await fetch(`${files}/files/${key}`, { method: 'HEAD', headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`파일 확인 실패 (${r.status})`);
      return Number(r.headers.get('Content-Length'));
    },
  };
}
