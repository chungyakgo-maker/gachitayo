// 폰 기록 → 서버 표 행 (사양서 6.5). owner_id는 서버 기본값(auth.uid())으로 채운다.
import type { Course } from '../types/course';
import type { DriveResultRecord } from '../types/drive';
import type { SessionRecord } from '../types/session';

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: number | null) => (v === null ? null : Math.round(v));

export function courseRow(c: Course) {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    source: c.source,
    origin: c.origin,
    start_gate: c.startGate,
    finish_gate: c.finishGate,
    centerline: c.centerline,
    length_m: c.lengthM,
    sector_bounds_m: c.sectorBoundsM,
    version: c.version,
    builtin: c.builtin ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function sessionRow(s: SessionRecord, r: DriveResultRecord, rawKey: string | null, processedKey: string) {
  return {
    id: s.id,
    course_id: r.courseId,
    course_version: r.courseVersion,
    started_at: iso(s.startedAt),
    ended_at: s.endedAt === null ? null : iso(s.endedAt),
    device: s.device,
    calibration: s.calibration,
    raw_key: rawKey,
    processed_key: processedKey,
    format_version: 1,
  };
}

export function lapRows(sessionId: string, r: DriveResultRecord) {
  return r.laps.map((l) => ({
    session_id: sessionId,
    lap_no: l.lapNo,
    lap_time_ms: Math.round(l.lapTimeMs),
    sector_times_ms: l.sectorTimesMs.map(ms),
    valid: l.valid,
    invalid_reason: l.invalidReason,
    max_speed: Math.round(l.maxSpeed * 100) / 100,
    trace: l.trace,
  }));
}

export type CourseRow = ReturnType<typeof courseRow>;
export type SessionRow = ReturnType<typeof sessionRow>;
export type LapRow = ReturnType<typeof lapRows>[number];

/** 처리된 궤적 파일 (사양서 6.7): 10 Hz 열 단위 */
export function processedFile(r: DriveResultRecord) {
  return { formatVersion: 1, sessionId: r.sessionId, courseId: r.courseId, courseVersion: r.courseVersion, ...r.processed };
}
