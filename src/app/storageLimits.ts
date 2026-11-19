// 폰 저장 공간 한도 (설계 2026-11-18-local-records-course-share-design.md 1부, 시안 ①):
// 원본 센서 자료는 최근 RAW_KEEP 개 주행만 남기고(오래된 것부터 정리), 내 코스는 MY_COURSE_LIMIT 개까지.
// 원본을 지운 기록은 rawPruned — 랩·요약·궤적·분석·내보내기는 되고, 다시 재생·다시 계산만 안 된다.
import type { DriveRepo } from '../storage/driveRepo';
import type { SessionRepo } from '../storage/sessionRepo';
import type { SessionRecord } from '../types/session';
import { MY_COURSE_LIMIT, RAW_KEEP } from './limits';

export const COURSE_LIMIT_TEXT = `내 코스가 ${MY_COURSE_LIMIT}개예요. 안 쓰는 코스를 지운 뒤 다시 해 주세요`;

/** 원본 한도에 세는 기록: 처리가 끝난 것만. 주행 중·계산 전·일반 주행·되살리는 중인 것은 건드리지 않는다 */
const counted = (s: SessionRecord): boolean => (s.status === 'processed' || s.status === 'uploaded') && !s.noRecord && !s.restoring;

/** 최근 keep 개 밖의 기록에서 원본 덩어리를 지운다. 원본을 실제로 지운 기록 수 */
export async function pruneOldRaw(repo: SessionRepo, keep = RAW_KEEP): Promise<number> {
  const list = (await repo.list()).filter(counted).sort((a, b) => b.startedAt - a.startedAt);
  let n = 0;
  for (const s of list.slice(keep)) {
    if ((await repo.deleteChunks(s.id)) > 0) n++;
    if (!s.rawPruned) await repo.update(s.id, { rawPruned: true });
  }
  return n;
}

/** 원본 덩어리(5초) 하나의 대략 크기: GPS 5개 + 모션 약 300개 (실제 크기를 읽지 않고 어림한다) */
const CHUNK_BYTES = 20_000;

export interface StorageSummary {
  /** 기록 수 (처리 끝난 것) */
  sessions: number;
  /** 원본이 남아 있는 기록 수 */
  rawSessions: number;
  /** 원본 대략 크기 */
  rawBytes: number;
  /** 내 코스 수 (기본 코스 빼고) */
  myCourses: number;
  /** 지금 정리할 수 있는 원본 (최근 RAW_KEEP 개 밖인데 원본이 남은 기록) */
  prunable: number;
  /** 디고가 쓰는 폰 저장 공간 (모르면 null) */
  usage: { used: number; quota: number } | null;
}

export async function storageSummary(repo: SessionRepo, drive: DriveRepo, keep = RAW_KEEP): Promise<StorageSummary> {
  const list = (await repo.list()).filter(counted).sort((a, b) => b.startedAt - a.startedAt);
  let rawSessions = 0;
  let chunks = 0;
  let prunable = 0;
  for (const [i, s] of list.entries()) {
    const n = await repo.chunkCount(s.id);
    if (n === 0) continue;
    rawSessions++;
    // 옮기거나 불러온 기록은 덩어리 하나에 주행 전체가 들어 있다 → 주행 시간(5초에 덩어리 하나)으로도 어림해 큰 쪽 (검토 지적)
    const byTime = s.endedAt ? Math.ceil((s.endedAt - s.startedAt) / 5000) : 0;
    chunks += Math.max(n, byTime);
    if (i >= keep) prunable++;
  }
  let usage: StorageSummary['usage'] = null;
  try {
    const e = await navigator.storage?.estimate?.();
    if (e?.usage !== undefined && e.quota) usage = { used: e.usage, quota: e.quota };
  } catch {
    // 모르면 막대 없이 숫자만
  }
  return { sessions: list.length, rawSessions, rawBytes: chunks * CHUNK_BYTES, myCourses: await myCourseCount(drive), prunable, usage };
}

/** 기본 코스를 뺀 코스 수 */
export async function myCourseCount(drive: DriveRepo): Promise<number> {
  return (await drive.listCourses()).filter((c) => !c.builtin).length;
}

/** adding 개를 더 넣을 자리가 있는지. 없으면 안내 문구로 던진다 */
export async function assertCourseRoom(drive: DriveRepo, adding = 1): Promise<void> {
  if ((await myCourseCount(drive)) + adding > MY_COURSE_LIMIT) throw new Error(COURSE_LIMIT_TEXT);
}
