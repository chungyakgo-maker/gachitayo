// 기록 지우기 (기록은 폰에만 2단계, 설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md "기록 지우기"):
// 기록·코스는 이제 서버에 올리지 않는다. 다만 예전 앱(1.0.0)이 올려 둔 사본이 서버에 남아 있으니, 그 기록을 지우면 서버 사본도 지운다
// (그래야 "기록은 폰에만" 안내가 맞고, 처음 한 번 옮기기가 지운 기록을 되살리지 않는다).
// 통신이 안 되면 작은 "지울 것" 목록(localStorage)에 남겨 다음 실행·통신 복구 때 다시 보낸다.
import { ApiError, apiFetch } from '../server/api';
import { serverConfig } from '../server/config';
import { getAuth } from './account';
import { getDriveRepo, getQueueRepo, getRecordingState, getRepo, refreshSessions } from './recording';

const KEY = 'gachitayo.serverDeletes.v1';

export interface ServerDeletes {
  sessions: string[];
  courses: string[];
}

function read(): ServerDeletes {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ServerDeletes> | null;
    return { sessions: Array.isArray(o?.sessions) ? o.sessions : [], courses: Array.isArray(o?.courses) ? o.courses : [] };
  } catch {
    return { sessions: [], courses: [] };
  }
}
function write(d: ServerDeletes): void {
  try {
    if (d.sessions.length || d.courses.length) localStorage.setItem(KEY, JSON.stringify(d));
    else localStorage.removeItem(KEY);
  } catch {
    // 저장할 수 없으면 이번 실행에서 보낸 것만 지워진다
  }
}
function add(kind: keyof ServerDeletes, id: string): void {
  const d = read();
  if (!d[kind].includes(id)) d[kind].push(id);
  write(d);
}
function drop(kind: keyof ServerDeletes, id: string): void {
  const d = read();
  d[kind] = d[kind].filter((x) => x !== id);
  write(d);
}

/** 서버에서 지워야 하는데 아직 못 지운 것 (옮기기는 이 id 를 받지 않는다) */
export const pendingServerDeletes = (): ServerDeletes => read();

let flushing: Promise<void> | null = null;

/** 지울 것 목록을 보낸다: 기록 먼저, 코스 나중 (서버는 기록이 남은 코스를 409로 거절한다). 이미 도는 중이면 그것을 기다린다 */
export function flushServerDeletes(): Promise<void> {
  flushing ??= (async () => {
    const auth = getAuth();
    if (!auth || !serverConfig.apiUrl) return;
    for (const [kind, path] of [
      ['sessions', '/api/sessions/'],
      ['courses', '/api/courses/'],
    ] as const) {
      for (const id of read()[kind]) {
        try {
          await apiFetch('DELETE', `${path}${id}`, { token: auth.token });
          drop(kind, id);
        } catch (e) {
          // 남의 것(403)·이미 없음(404)이면 지울 것이 없다. 통신이 끊기면 나머지는 다음에
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) drop(kind, id);
          else if (!(e instanceof ApiError)) return;
        }
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** 기록 지우기: 폰에서 세션·덩어리·결과·비교 랩을 지우고, 예전에 서버에 올라간 기록이면 서버 사본도 지운다 */
export async function deleteSessionRecord(sessionId: string): Promise<void> {
  if (getRecordingState().sessionId === sessionId) throw new Error('기록 중인 주행은 지울 수 없어요');
  const s = await getRepo().get(sessionId);
  await getDriveRepo().deleteSession(sessionId);
  await refreshSessions();
  if (s?.uploadedAt) {
    add('sessions', sessionId);
    await flushServerDeletes();
  }
}

/** 코스를 지웠을 때 서버의 예전 코스 행도 지운다 (없으면 404로 끝, 그 코스의 서버 기록이 남았으면 다음에 다시) */
export async function forgetServerCourse(courseId: string): Promise<void> {
  add('courses', courseId);
  await flushServerDeletes();
}

let started = false;

/** 앱 시작 때 한 번: 예전 업로드 대기열에서 서버 지우기만 목록으로 옮기고(올리기는 버림) 대기열을 비운 뒤 보낸다 */
export async function initRecords(): Promise<void> {
  if (!started && typeof window !== 'undefined') window.addEventListener('online', () => void flushServerDeletes());
  started = true;
  try {
    const q = getQueueRepo();
    for (const item of await q.all()) {
      if (item.kind === 'session-delete') add('sessions', item.targetId);
      else if (item.kind === 'course-delete') add('courses', item.targetId);
      await q.remove(item.id);
    }
  } catch {
    // 저장소를 열 수 없으면 다음 실행 때
  }
  await flushServerDeletes();
}
