// 업로드 대상: 같이타요 API (표) + 파일 게이트웨이 (사양서 6.5, 6.6)
import { getAuth, markAccountLost } from '../app/account';
import type { Remote } from '../sync/syncEngine';
import { ApiError, apiFetch } from './api';
import { serverConfig } from './config';

export function createRemote(): Remote {
  const call = async (method: string, path: string, body: unknown, what: string) => {
    const token = getAuth()?.token;
    try {
      await apiFetch(method, path, { token, body });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) markAccountLost(token);
        // 상태 번호를 남긴다 (지우기 403은 다른 계정의 것이라 다시 시도하지 않는다)
        throw Object.assign(new Error(`${what} 실패 (${e.status} ${e.message})`), { status: e.status });
      }
      throw e;
    }
  };
  return {
    userId: async () => getAuth()?.userId ?? null,
    token: async () => getAuth()?.token ?? null,
    upsertCourse: (row) => call('PUT', `/api/courses/${row.id}`, row, '코스 저장'),
    upsertSession: (row) => call('PUT', `/api/sessions/${row.id}`, row, '세션 저장'),
    replaceLaps: (sessionId, rows) => call('PUT', `/api/sessions/${sessionId}/laps`, rows, '랩 저장'),
    deleteSession: (sessionId) => call('DELETE', `/api/sessions/${sessionId}`, undefined, '기록 지우기'),
    deleteCourse: (courseId) => call('DELETE', `/api/courses/${courseId}`, undefined, '코스 지우기'),
    async putFile(key, bytes, token) {
      const r = await fetch(`${serverConfig.apiUrl}/files/${key}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' },
        body: bytes,
      });
      if (r.status === 401) markAccountLost(token);
      if (!r.ok) throw new Error(`파일 업로드 실패 (${r.status})`);
    },
    async headFile(key, token) {
      const r = await fetch(`${serverConfig.apiUrl}/files/${key}`, { method: 'HEAD', headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`파일 확인 실패 (${r.status})`);
      return Number(r.headers.get('Content-Length'));
    },
  };
}
