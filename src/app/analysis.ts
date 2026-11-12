// 분석 화면 데이터 (사양서 8.6): 세션, 처리 결과, 코스, 같은 코스의 비교 랩(다른 세션 포함)
import type { Course } from '../types/course';
import type { DriveResultRecord, RefLapRecord } from '../types/drive';
import type { SessionRecord } from '../types/session';
import { getDriveRepo, getRepo } from './recording';

export interface AnalysisData {
  session: SessionRecord;
  result: DriveResultRecord | null;
  course: Course | null;
  /** 같은 코스·버전의 다른 세션 랩 (빠른 순, 처음 8개) */
  otherRefs: RefLapRecord[];
}

export async function loadAnalysis(sessionId: string): Promise<AnalysisData | null> {
  const session = await getRepo().get(sessionId);
  if (!session) return null;
  const drive = getDriveRepo();
  const result = (await drive.getResult(sessionId)) ?? null;
  const course = result?.courseId ? ((await drive.getCourse(result.courseId)) ?? null) : null;
  const otherRefs = course ? (await drive.refLaps(course.id, course.version)).filter((r) => r.sessionId !== sessionId).slice(0, 8) : [];
  return { session, result, course, otherRefs };
}

/** 다른 세션 랩의 처리된 궤적 (그 세션 결과가 폰에 있으면 지도에 같이 그린다) */
export async function loadProcessedOf(sessionId: string): Promise<DriveResultRecord['processed'] | null> {
  return (await getDriveRepo().getResult(sessionId))?.processed ?? null;
}
