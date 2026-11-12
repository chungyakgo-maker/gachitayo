// 업로드 (사양서 5.4-4): 원본·처리된 궤적 파일을 먼저 파일 게이트웨이로 R2에 올리고(크기 확인),
// 성공하면 코스·세션·랩을 서버 표(D1)에 올린다(같은 id면 덮어씀). 그래서 표가 없는 파일을 가리키는 일이 없다.
// 실패하면 대기열에 남기고 지수 백오프로 다시 시도한다 (9장). 업로드 7일 뒤 원본 덩어리를 정리한다 (6.4).
import { buildRawFile } from '../storage/rawFile';
import { gzipJson } from '../storage/gzip';
import type { DriveRepo } from '../storage/driveRepo';
import type { QueueRepo } from '../storage/queueRepo';
import type { SessionRepo } from '../storage/sessionRepo';
import { courseRow, lapRows, processedFile, sessionRow, type CourseRow, type LapRow, type SessionRow } from './rows';

export interface Remote {
  /** 로그인한 사용자 ID. 계정이 없으면 null (업로드하지 않음) */
  userId(): Promise<string | null>;
  token(): Promise<string | null>;
  upsertCourse(row: CourseRow): Promise<void>;
  upsertSession(row: SessionRow): Promise<void>;
  /** 세션의 랩을 통째로 바꾼다 (다시 처리해서 랩이 줄어도 옛 랩이 남지 않게) */
  replaceLaps(sessionId: string, rows: LapRow[]): Promise<void>;
  putFile(key: string, bytes: Uint8Array<ArrayBuffer>, token: string): Promise<void>;
  /** 파일 크기. 없으면 null */
  headFile(key: string, token: string): Promise<number | null>;
  /** 기록 지우기: 랩·세션 행과 원본·처리된 파일 (없어도 성공) */
  deleteSession(sessionId: string): Promise<void>;
}

export interface SyncDeps {
  sessions: SessionRepo;
  drive: DriveRepo;
  queue: QueueRepo;
  remote: Remote;
  now: () => number;
}

const BACKOFF_START_MS = 10_000;
const BACKOFF_MAX_MS = 30 * 60_000;
const KEEP_RAW_AFTER_UPLOAD_MS = 7 * 86_400_000;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.max(0, attempts - 1));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function syncOnce(deps: SyncDeps): Promise<{ done: number; failed: number; lastError: string | null }> {
  const due = await deps.queue.due(deps.now());
  let done = 0;
  let failed = 0;
  let lastError: string | null = null;
  if (due.length === 0) return { done, failed, lastError };
  const userId = await deps.remote.userId();
  if (!userId) return { done, failed, lastError };
  for (const item of due) {
    try {
      if (item.kind === 'session-delete') await deps.remote.deleteSession(item.targetId);
      else if (item.kind === 'course') {
        const c = await deps.drive.getCourse(item.targetId);
        if (c) await deps.remote.upsertCourse(courseRow(c));
      } else await uploadSession(deps, userId, item.targetId);
      await deps.queue.remove(item.id);
      done++;
    } catch (e) {
      failed++;
      lastError = message(e);
      const attempts = item.attempts + 1;
      await deps.queue.update({ ...item, attempts, lastError, nextAt: deps.now() + backoffMs(attempts) });
      // 통신이 안 되는 것(fetch 실패)이면 나머지도 실패할 테니 다음 기회에
      if (e instanceof TypeError) break;
    }
  }
  return { done, failed, lastError };
}

async function uploadSession(deps: SyncDeps, userId: string, sessionId: string): Promise<void> {
  const { sessions, drive, remote } = deps;
  const [session, result] = await Promise.all([sessions.get(sessionId), drive.getResult(sessionId)]);
  if (!session || !result) return; // 지워졌거나 아직 처리 전: 올릴 것이 없다
  const token = await remote.token();
  if (!token) throw new Error('로그인 토큰이 없습니다');

  if (result.courseId) {
    const course = await drive.getCourse(result.courseId);
    if (course) await remote.upsertCourse(courseRow(course));
  }

  const base = `${userId}/${sessionId}`;
  const put = async (key: string, bytes: Uint8Array<ArrayBuffer>) => {
    await remote.putFile(key, bytes, token);
    const size = await remote.headFile(key, token);
    if (size !== bytes.byteLength) {
      throw new Error(`업로드 확인 실패 (${key.split('.').at(-3)} 크기 ${size ?? '없음'} ≠ ${bytes.byteLength})`);
    }
  };
  const chunks = await sessions.chunks(sessionId);
  let rawKey: string | null = null;
  if (chunks.length > 0) {
    rawKey = `${base}.raw.json.gz`;
    await put(rawKey, await gzipJson(buildRawFile(session, chunks)));
  } else if (session.uploadedAt) {
    rawKey = `${base}.raw.json.gz`; // 예전에 올리고 폰에서 정리한 원본
  }
  const processedKey = `${base}.processed.json.gz`;
  await put(processedKey, await gzipJson(processedFile(result)));

  await remote.upsertSession(sessionRow(session, result, rawKey, processedKey));
  await remote.replaceLaps(sessionId, lapRows(sessionId, result));
  await sessions.update(sessionId, { status: 'uploaded', uploadedAt: deps.now() });
}

/** 업로드하고 7일 지난 세션의 원본 덩어리를 지운다. 올리지 않은 원본은 절대 지우지 않는다. 지운 세션 수 */
export async function cleanupUploaded(deps: Pick<SyncDeps, 'sessions' | 'now'>): Promise<number> {
  let n = 0;
  for (const s of await deps.sessions.list()) {
    if (s.status !== 'uploaded' || !s.uploadedAt || deps.now() - s.uploadedAt < KEEP_RAW_AFTER_UPLOAD_MS) continue;
    if ((await deps.sessions.deleteChunks(s.id)) > 0) n++;
  }
  return n;
}
