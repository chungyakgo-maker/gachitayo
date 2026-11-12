// 동기화 관리 (사양서 5.4-4, 8.8 동기화 상태, 9장): 처리한 세션을 대기열에 넣고,
// 앱 시작·통신 복구·화면 복귀·처리 직후·1분마다 올린다. 실패는 지수 백오프로 다시 시도한다.
import { useSyncExternalStore } from 'react';
import { createRemote } from '../server/remote';
import { uploadEnabled } from '../server/config';
import { cleanupUploaded, syncOnce, type SyncDeps } from '../sync/syncEngine';
import { ensureAccount, getAccountState, subscribeAccount } from './account';
import { getDriveRepo, getQueueRepo, getRecordingState, getRepo, refreshSessions } from './recording';

export interface SyncState {
  /** 서버 설정값이 있어 업로드할 수 있는지 */
  enabled: boolean;
  pending: number;
  running: boolean;
  lastError: string | null;
  /** 마지막으로 하나라도 올린 시각 */
  lastSyncAt: number | null;
}

let state: SyncState = { enabled: uploadEnabled(), pending: 0, running: false, lastError: null, lastSyncAt: null };
const listeners = new Set<() => void>();
function set(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getSyncState = (): SyncState => state;
export function useSync(): SyncState {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getSyncState);
}

let deps: SyncDeps | null = null;
function getDeps(): SyncDeps {
  deps ??= { sessions: getRepo(), drive: getDriveRepo(), queue: getQueueRepo(), remote: createRemote(), now: () => Date.now() };
  return deps;
}

async function refreshPending(): Promise<void> {
  try {
    set({ pending: await getQueueRepo().count() });
  } catch {
    // 저장소를 열 수 없으면 그대로
  }
}

/** 처리한 세션을 올릴 차례에 넣는다 (서버 설정 전이어도 넣어 두면 설정 뒤에 올라간다) */
export async function enqueueSessionUpload(sessionId: string): Promise<void> {
  await getQueueRepo().enqueue('session', sessionId, Date.now());
  await refreshPending();
  void kickSync();
}

let running: Promise<void> | null = null;

/** 지금 올릴 수 있는 것을 올린다 (이미 도는 중이면 그것을 기다린다) */
export function kickSync(): Promise<void> {
  if (!state.enabled) return Promise.resolve();
  // 계정이 아직 없으면 먼저 만든다 (만들어지면 아래 구독이 다시 올린다)
  if (getAccountState().status !== 'ready') return ensureAccount();
  running ??= (async () => {
    set({ running: true });
    try {
      const d = getDeps();
      const r = await syncOnce(d);
      await cleanupUploaded(d);
      set({ lastError: r.failed ? r.lastError : r.done ? null : state.lastError, ...(r.done ? { lastSyncAt: Date.now() } : {}) });
      if (r.done) await refreshSessions();
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      await refreshPending();
      set({ running: false });
      running = null;
    }
  })();
  return running;
}

/** 기록 지우기 (M10, 사용자 요청): 폰에서 세션·덩어리·결과·비교 랩을 지우고, 서버에서도 지우도록 대기열에 넣는다.
 *  통신이 없으면 연결될 때 지운다. 기록 중인 세션은 지울 수 없다 */
export async function deleteSessionRecord(sessionId: string): Promise<void> {
  if (getRecordingState().sessionId === sessionId) throw new Error('기록 중인 주행은 지울 수 없어요');
  await getDriveRepo().deleteSession(sessionId);
  const q = getQueueRepo();
  await q.remove(`session:${sessionId}`);
  if (state.enabled) await q.enqueue('session-delete', sessionId, Date.now());
  await refreshSessions();
  await refreshPending();
  void kickSync();
}

/** 설정의 "다시 시도": 기다리는 것을 모두 지금 시도한다 */
export async function retryNow(): Promise<void> {
  const q = getQueueRepo();
  for (const item of await q.all()) await q.update({ ...item, nextAt: 0 });
  await kickSync();
}

let started = false;

/** 앱 시작 때 한 번 */
export async function initSync(): Promise<void> {
  if (started) return;
  started = true;
  // 예전에 처리만 하고 올리지 않은 세션(M5 이전 기록 등)을 대기열에 넣는다
  try {
    const q = getQueueRepo();
    const queued = new Set((await q.all()).map((i) => i.targetId));
    for (const s of await getRepo().list()) {
      if (s.status === 'processed' && !queued.has(s.id)) await q.enqueue('session', s.id, Date.now());
    }
  } catch {
    // 저장소 오류는 기록 화면에서 따로 알린다
  }
  await refreshPending();
  // 첫 실행에서 계정을 만들면 바로 올린다
  let wasReady = getAccountState().status === 'ready';
  subscribeAccount(() => {
    const ready = getAccountState().status === 'ready';
    if (ready && !wasReady) void kickSync();
    wasReady = ready;
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void kickSync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void kickSync();
    });
    setInterval(() => void kickSync(), 60_000);
  }
  void kickSync();
}
