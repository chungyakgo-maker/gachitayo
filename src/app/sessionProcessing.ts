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

/** 벗어난 길 저장을 물어보는 거리 (랩 안에서 코스를 벗어나 달린 거리 합) */
export const DETOUR_MIN_M = 200;

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
  // 코스를 200 m 넘게 벗어났으면 코스 없이 한 번 더 계산해 실제로 달린 길 코스를 만든다 (새 코스로 저장·덮어쓰기 제안)
  let detourCourse: Course | null = null;
  if (used && r.offCourseM >= DETOUR_MIN_M) {
    const d = await run({ ...raw, course: null, newCourse: { id: newId(), name: '', kind: used.kind }, startedAtEpochMs: session.startedAt });
    detourCourse = d.courseCreated ? d.course : null;
  }
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
    offCourseM: r.offCourseM,
    detourCourse,
  };
  await deps.drive.putResult(rec);
  // 이 세션의 예전 비교 랩은 지우고 지금 결과로 (다른 코스로 옮겼거나 다시 계산한 경우)
  await deps.drive.deleteRefLapsOfSession(sessionId);
  if (used) await deps.drive.putRefLaps(refLapsFrom(rec, session, used));
  await deps.sessions.update(sessionId, {
    status: 'processed',
    courseId: used?.id ?? null,
    courseVersion: used?.version ?? null,
    summary: summaryOf(rec, used),
  });
  return rec;
}

/** 벗어난 길을 새 코스로 저장하고, 이 주행을 그 코스로 옮겨 다시 계산한다 (원래 코스에서는 빠진다) */
export async function saveDetourAsNew(deps: ProcessDeps, sessionId: string, name: string): Promise<{ result: DriveResultRecord; course: Course }> {
  const rec = await deps.drive.getResult(sessionId);
  if (!rec?.detourCourse) throw new Error('저장할 길이 없습니다');
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const { builtin: _builtin, ...d } = rec.detourCourse;
  const course: Course = { ...d, id: newId(), name: name.trim() || '새 코스', source: 'auto', version: 1 };
  await deps.drive.putCourse(course);
  await deps.sessions.update(sessionId, { courseId: course.id, courseVersion: course.version });
  return { result: await processStoredSession(deps, sessionId), course };
}

/** 지금 코스(내 코스만)를 벗어난 길로 덮어쓴다: id·이름은 그대로, 선·출발·도착선을 바꾸고 버전 +1. 이 주행은 바뀐 코스로 다시 계산한다 */
export async function overwriteWithDetour(deps: ProcessDeps, sessionId: string): Promise<{ result: DriveResultRecord; course: Course }> {
  const [session, rec] = await Promise.all([deps.sessions.get(sessionId), deps.drive.getResult(sessionId)]);
  if (!session?.courseId || !rec?.detourCourse) throw new Error('덮어쓸 길이 없습니다');
  const cur = await deps.drive.getCourse(session.courseId);
  if (!cur) throw new Error('코스를 찾을 수 없습니다');
  if (cur.builtin) throw new Error('기본 코스는 덮어쓸 수 없어요');
  const d = rec.detourCourse;
  const course: Course = {
    ...cur,
    kind: d.kind,
    origin: d.origin,
    startGate: d.startGate,
    finishGate: d.finishGate,
    centerline: d.centerline,
    lengthM: d.lengthM,
    sectorBoundsM: d.sectorBoundsM,
    version: cur.version + 1,
  };
  await deps.drive.putCourse(course);
  await deps.sessions.update(sessionId, { courseVersion: course.version });
  return { result: await processStoredSession(deps, sessionId), course };
}

/** 벗어난 길 저장 제안을 닫는다 (이 주행은 지금처럼 남는다) */
export async function dismissDetour(deps: ProcessDeps, sessionId: string): Promise<DriveResultRecord> {
  const rec = await deps.drive.getResult(sessionId);
  if (!rec) throw new Error('기록을 찾을 수 없습니다');
  const next = { ...rec, detourCourse: null };
  await deps.drive.putResult(next);
  return next;
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
