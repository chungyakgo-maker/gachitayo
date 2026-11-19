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

/** 기본 코스를 뺀 코스 수 */
export async function myCourseCount(drive: DriveRepo): Promise<number> {
  return (await drive.listCourses()).filter((c) => !c.builtin).length;
}

/** adding 개를 더 넣을 자리가 있는지. 없으면 안내 문구로 던진다 */
export async function assertCourseRoom(drive: DriveRepo, adding = 1): Promise<void> {
  if ((await myCourseCount(drive)) + adding > MY_COURSE_LIMIT) throw new Error(COURSE_LIMIT_TEXT);
}
