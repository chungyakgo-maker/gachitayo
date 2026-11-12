// 주행이 끝난 뒤: 폰에 저장된 원본 → 주행 후 처리(사양서 5.4) → 결과·비교 랩·세션 요약 저장.
// 첫 주행이면 코스를 제안만 하고, 사용자가 종료 화면에서 종류·이름을 정해 저장한다 (사양서 8.5).
import type { DriveInput, DriveResult } from '../engine/process/processDrive';
import type { DriveRepo } from '../storage/driveRepo';
import type { SessionRepo } from '../storage/sessionRepo';
import type { Course, CourseKind } from '../types/course';
import type { DriveResultRecord, RefLapRecord, SessionSummary } from '../types/drive';
import type { GpsSample, RawMotionSample, SessionEvent } from '../types/samples';
import type { SessionRecord } from '../types/session';
import { runProcessDrive } from './runProcessDrive';

export interface ProcessDeps {
  sessions: SessionRepo;
  drive: DriveRepo;
  run?: (input: DriveInput) => Promise<DriveResult>;
  newId?: () => string;
  now?: () => number;
}

/** 저장된 덩어리를 이어 붙인 원본 */
export async function loadRaw(
  sessions: SessionRepo,
  sessionId: string,
): Promise<{ gps: GpsSample[]; motion: RawMotionSample[]; events: SessionEvent[] }> {
  const chunks = await sessions.chunks(sessionId);
  return {
    gps: chunks.flatMap((c) => c.gps),
    motion: chunks.flatMap((c) => c.rawMotion),
    events: chunks.flatMap((c) => c.events),
  };
}

/** 세션을 처리하고 저장한다. kind: 첫 주행에서 사용자가 고른 코스 종류 */
export async function processStoredSession(deps: ProcessDeps, sessionId: string, kind?: CourseKind): Promise<DriveResultRecord> {
  const session = await deps.sessions.get(sessionId);
  if (!session) throw new Error('기록을 찾을 수 없습니다');
  const raw = await loadRaw(deps.sessions, sessionId);
  if (raw.gps.length === 0) throw new Error('GPS 기록이 없어 처리할 수 없습니다 (위치를 한 번도 받지 못함)');
  const course = session.courseId ? ((await deps.drive.getCourse(session.courseId)) ?? null) : null;
  const run = deps.run ?? runProcessDrive;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const r = await run({ ...raw, course, newCourse: course ? undefined : { id: newId(), name: '', kind }, startedAtEpochMs: session.startedAt });

  const proposed = r.courseCreated ? r.course : null;
  const used = proposed ? null : r.course;
  if (used && r.courseUpdated) await deps.drive.putCourse(used);
  // 이 주행 전의 내 베스트 (같은 세션을 다시 처리할 때는 이 세션 랩을 뺀다)
  const previousBestMs = used
    ? ((await deps.drive.refLaps(used.id, used.version)).find((l) => l.sessionId !== sessionId)?.lapTimeMs ?? null)
    : null;
  const rec: DriveResultRecord = {
    sessionId,
    courseId: used?.id ?? null,
    courseVersion: used?.version ?? null,
    processedAt: (deps.now ?? Date.now)(),
    laps: r.laps,
    theoreticalBest: r.theoreticalBest,
    bestLapNo: r.bestLap?.lapNo ?? null,
    processed: r.processed,
    fusion: { gpsOnly: r.fusion.gpsOnly, speedQualityLow: r.fusion.speedQualityLow, axisSigns: r.fusion.axisSigns },
    proposedCourse: proposed,
    previousBestMs,
  };
  await deps.drive.putResult(rec);
  if (used) await deps.drive.putRefLaps(refLapsFrom(rec, session, used));
  await deps.sessions.update(sessionId, {
    status: 'processed',
    courseId: used?.id ?? null,
    courseVersion: used?.version ?? null,
    summary: summaryOf(rec, used),
  });
  return rec;
}

/** 첫 주행: 종료 화면에서 코스 종류를 바꾸면 그 종류로 다시 만든다 */
export function changeProposedKind(deps: ProcessDeps, sessionId: string, kind: CourseKind): Promise<DriveResultRecord> {
  return processStoredSession(deps, sessionId, kind);
}

/** 첫 주행: 제안한 코스를 이름을 붙여 저장한다 */
export async function saveProposedCourse(
  deps: ProcessDeps,
  sessionId: string,
  name: string,
): Promise<{ result: DriveResultRecord; course: Course }> {
  const [session, rec] = await Promise.all([deps.sessions.get(sessionId), deps.drive.getResult(sessionId)]);
  if (!session || !rec?.proposedCourse) throw new Error('저장할 코스가 없습니다');
  const course: Course = { ...rec.proposedCourse, name: name.trim() || '새 코스' };
  await deps.drive.putCourse(course);
  const result: DriveResultRecord = { ...rec, courseId: course.id, courseVersion: course.version, proposedCourse: null, previousBestMs: null };
  await deps.drive.putResult(result);
  await deps.drive.putRefLaps(refLapsFrom(result, session, course));
  await deps.sessions.update(sessionId, { courseId: course.id, courseVersion: course.version, summary: summaryOf(result, course) });
  return { result, course };
}

function refLapsFrom(rec: DriveResultRecord, session: SessionRecord, course: Course): RefLapRecord[] {
  return rec.laps
    .filter((l) => l.valid)
    .map((l) => ({
      id: `${session.id}:${l.lapNo}`,
      courseId: course.id,
      courseVersion: course.version,
      sessionId: session.id,
      lapNo: l.lapNo,
      startedAt: session.startedAt,
      lapTimeMs: l.lapTimeMs,
      sectorTimesMs: l.sectorTimesMs,
      trace: l.trace,
    }));
}

function summaryOf(rec: DriveResultRecord, course: Course | null): SessionSummary {
  const valid = rec.laps.filter((l) => l.valid);
  return {
    courseName: course?.name ?? null,
    lapCount: rec.laps.length,
    validLapCount: valid.length,
    bestLapMs: valid.length ? Math.min(...valid.map((l) => l.lapTimeMs)) : null,
  };
}
