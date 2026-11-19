// 인기 도로 새 신호 (기록은 폰에만 4단계, 설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md "인기 도로"):
// 기록을 서버에 안 올리니 인기 도로 수를 셀 수 없다 → 기본 코스로 유효 랩(편도는 완주)을 1번 이상 마친 주행을 처리하면
// "이 코스를 달렸다"(코스 열쇠만, 위치·시각 없음 — 날짜는 서버가 받은 날)를 한 번 보낸다. 실패는 그냥 넘어간다
import { apiFetch } from '../server/api';
import type { Course } from '../types/course';
import type { DriveResultRecord } from '../types/drive';
import { getAuth } from './account';

/** 하루가 지난 주행(코스를 고쳐 다시 계산한 옛 기록)은 오늘 달린 것으로 세지 않는다 */
const FRESH_MS = 24 * 3_600_000;

/** 보낼 코스 열쇠. 보낼 것이 아니면 null */
export function droveKeyOf(result: Pick<DriveResultRecord, 'laps'>, course: Pick<Course, 'builtin'> | null, startedAt: number, now = Date.now()): string | null {
  if (!course?.builtin || now - startedAt > FRESH_MS) return null;
  return result.laps.some((l) => l.valid) ? `b:${course.builtin}` : null;
}

export async function reportDrove(courseKey: string): Promise<void> {
  const auth = getAuth();
  if (!auth) return;
  try {
    await apiFetch('POST', '/api/drove', { token: auth.token, body: { course: courseKey } });
  } catch {
    // 인기 숫자 하나라 다시 보내지 않는다
  }
}
