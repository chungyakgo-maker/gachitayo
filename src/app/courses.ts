// 코스 관리 (사양서 8.7, M10): 이름 바꾸기, 출발선·도착선 옮기기, 코스 다듬기, 지도에서 새 코스, GPX 불러오기·내보내기.
// 선을 옮기거나 다듬으면 version +1이고 이 코스의 내 기록을 모두 원본에서 다시 계산한다 (질문 5 결정).
// 폰에서 원본을 정리한 기록은 서버에서 원본을 받아 다시 계산한다.
import { builtinCourse, missingBuiltins } from '../courses/builtin';
import { refineCourse, moveGate } from '../engine/course/edit';
import { gateFromPoint } from '../engine/course/geometry';
import { fromLocal, toLocal, type LatLon } from '../engine/geo';
import { courseFromGpx, gpsSamplesFromGpx } from '../gpx/course';
import { courseToGpx } from '../gpx/export';
import { parseGpx } from '../gpx/parse';
import { serverConfig } from '../server/config';
import { gunzipJson } from '../storage/gzip';
import { readRawFile } from '../storage/rawFile';
import type { Course, CourseKind } from '../types/course';
import type { SessionRecord } from '../types/session';
import { getAuth } from './account';
import { loadCourses, processSession } from './drive';
import { getDriveRepo, getQueueRepo, getRecordingState, getRepo, refreshSessions } from './recording';
import { getSettings } from './settings';
import { deleteSessionRecord, enqueueCourseDelete, kickSync } from './sync';

/** 코스를 서버에 올리도록 대기열에 (이름·선이 바뀌었을 때) */
async function queueCourse(id: string): Promise<void> {
  if (!serverConfig.apiUrl) return;
  await getQueueRepo().enqueue('course', id, Date.now());
  void kickSync();
}

async function saveCourseRecord(c: Course): Promise<void> {
  await getDriveRepo().putCourse(c);
  await queueCourse(c.id);
  await loadCourses();
}

let seeding: Promise<void> | undefined;

/** 기본 코스(사양서 7.5)가 이 폰의 코스 목록에 없으면 넣는다. 앱 시작 때 한 번.
 *  서버로 따로 올리지 않는다 (공유·별점은 앱 출시 뒤 계획). 그 코스로 달린 기록을 올릴 때만 다른 코스처럼 내 코스로 함께 간다 */
export function seedBuiltinCourses(): Promise<void> {
  seeding ??= (async () => {
    try {
      const drive = getDriveRepo();
      const missing = missingBuiltins(await drive.listCourses());
      if (missing.length === 0) return;
      const { BUILTIN_POINTS } = await import('../courses/builtinData');
      const gateWidthM = getSettings().gateWidthM;
      for (const b of missing) {
        const pts = BUILTIN_POINTS[b.key];
        if (pts) await drive.putCourse(builtinCourse(b, pts, { id: crypto.randomUUID(), gateWidthM }));
      }
      await loadCourses();
    } catch {
      seeding = undefined; // 다음에 다시
    }
  })();
  return seeding;
}

export async function renameCourse(id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n) throw new Error('이름을 적어 주세요');
  const c = await getDriveRepo().getCourse(id);
  if (!c) throw new Error('코스를 찾을 수 없어요');
  await saveCourseRecord({ ...c, name: n.slice(0, 40) });
}

/** 코스 지우기 (사용자 요청): 이 코스로 달린 기록을 모두 지우고(폰·서버), 코스와 비교 랩을 지운다.
 *  기본 코스(7.5)와 기록 중인 코스는 지울 수 없다. 지운 기록 수를 돌려준다 */
export async function deleteCourse(courseId: string): Promise<number> {
  const drive = getDriveRepo();
  const c = await drive.getCourse(courseId);
  if (!c) throw new Error('코스를 찾을 수 없어요');
  if (c.builtin) throw new Error('기본 코스는 지울 수 없어요');
  const rec = getRecordingState().sessionId;
  if (rec && (await getRepo().get(rec))?.courseId === courseId) throw new Error('기록 중인 코스는 지울 수 없어요');
  const list = await sessionsOfCourse(courseId);
  for (const s of list) await deleteSessionRecord(s.id);
  await drive.deleteCourse(courseId);
  await enqueueCourseDelete(courseId);
  await loadCourses();
  return list.length;
}

/** 이 코스의 기록 (최근 순) */
export async function sessionsOfCourse(courseId: string): Promise<SessionRecord[]> {
  return (await getRepo().list()).filter((s) => s.courseId === courseId && s.status !== 'recording');
}

/** 폰에서 원본을 정리한 기록이면 서버에서 원본을 받아 덩어리로 되돌린다 */
async function ensureRaw(s: SessionRecord): Promise<boolean> {
  const repo = getRepo();
  if ((await repo.chunks(s.id)).length > 0) return true;
  const auth = getAuth();
  if (!auth || !serverConfig.apiUrl || !s.uploadedAt) return false;
  try {
    const r = await fetch(`${serverConfig.apiUrl}/files/${auth.userId}/${s.id}.raw.json.gz`, { headers: { Authorization: `Bearer ${auth.token}` } });
    if (!r.ok) return false;
    const raw = readRawFile(await gunzipJson(new Uint8Array(await r.arrayBuffer())));
    await repo.putChunk({ sessionId: s.id, seq: 0, gps: raw.gps, rawMotion: raw.motion, events: raw.events, channels: raw.channels });
    return true;
  } catch {
    return false;
  }
}

/** 코스가 바뀐 뒤 이 코스의 기록을 모두 다시 계산한다. 원본을 구하지 못한 기록 수를 돌려준다 */
export async function recomputeCourse(courseId: string, onProgress?: (done: number, total: number) => void): Promise<{ done: number; skipped: number }> {
  const list = await sessionsOfCourse(courseId);
  let done = 0;
  let skipped = 0;
  for (const s of list) {
    onProgress?.(done + skipped, list.length);
    if (!(await ensureRaw(s))) {
      skipped++;
      continue;
    }
    await processSession(s.id);
    done++;
  }
  await refreshSessions();
  return { done, skipped };
}

/** 출발선(편도면 도착선)을 지도에서 누른 곳 근처 중심선 위로 옮긴다. version +1 */
export async function moveCourseGate(courseId: string, which: 'start' | 'finish', at: LatLon): Promise<Course> {
  const c = await getDriveRepo().getCourse(courseId);
  if (!c) throw new Error('코스를 찾을 수 없어요');
  const p = toLocal(c.origin, at.lat, at.lon);
  const moved = moveGate(c, which, p.x, p.y);
  await saveCourseRecord(moved);
  return moved;
}

/** 코스 다듬기: 같은 버전의 유효 랩 경로를 평균해 중심선을 다시 만든다 (유효 랩 3개 이상). version +1 */
export async function refineCourseFromLaps(courseId: string): Promise<Course> {
  const drive = getDriveRepo();
  const c = await drive.getCourse(courseId);
  if (!c) throw new Error('코스를 찾을 수 없어요');
  const paths: Array<{ x: number[]; y: number[] }> = [];
  for (const s of await sessionsOfCourse(courseId)) {
    const r = await drive.getResult(s.id);
    if (!r || r.courseId !== c.id || r.courseVersion !== c.version) continue;
    for (const lap of r.laps) {
      if (!lap.valid) continue;
      const x: number[] = [];
      const y: number[] = [];
      for (let k = 0; k < r.processed.n; k++) {
        if (r.processed.lapNo[k] !== lap.lapNo) continue;
        const q = toLocal(c.origin, r.processed.lat[k]!, r.processed.lon[k]!);
        x.push(q.x);
        y.push(q.y);
      }
      if (x.length > 10) paths.push({ x, y });
    }
  }
  const refined = refineCourse(c, paths);
  await saveCourseRecord(refined);
  return refined;
}

/** 다듬기에 쓸 수 있는 유효 랩 수 (같은 버전) */
export async function validLapCount(course: Course): Promise<number> {
  let n = 0;
  for (const s of await sessionsOfCourse(course.id)) {
    const r = await getDriveRepo().getResult(s.id);
    if (r && r.courseId === course.id && r.courseVersion === course.version) n += r.laps.filter((l) => l.valid).length;
  }
  return n;
}

export interface GatePick {
  /** 선 가운데 */
  at: LatLon;
  /** 진행 방향을 정하는 둘째 점 */
  toward: LatLon;
}

/** 지도에서 새 코스: 출발선(편도면 도착선도)의 위치와 진행 방향. 중심선은 첫 주행 뒤에 생긴다 (사양서 7.5) */
export async function createMapCourse(opts: { name: string; kind: CourseKind; start: GatePick; finish?: GatePick | null }): Promise<Course> {
  const name = opts.name.trim() || '새 코스';
  const origin = opts.start.at;
  const width = getSettings().gateWidthM;
  const gate = (g: GatePick) => {
    const a = toLocal(origin, g.at.lat, g.at.lon);
    const b = toLocal(origin, g.toward.lat, g.toward.lon);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) throw new Error('진행 방향 점을 출발선에서 조금 떨어진 곳에 찍어 주세요');
    return gateFromPoint(a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x), origin, width);
  };
  const start = gate(opts.start);
  if (opts.kind === 'point_to_point' && !opts.finish) throw new Error('편도는 도착선도 찍어 주세요');
  const finish = opts.kind === 'point_to_point' ? gate(opts.finish!) : start;
  const c: Course = {
    id: crypto.randomUUID(),
    name: name.slice(0, 40),
    kind: opts.kind,
    source: 'map',
    origin,
    startGate: start,
    finishGate: finish,
    centerline: null,
    lengthM: null,
    sectorBoundsM: null,
    version: 1,
  };
  await saveCourseRecord(c);
  return c;
}

export type GpxImport = { kind: 'course'; course: Course } | { kind: 'session'; sessionId: string };

/** GPX 불러오기: 코스로 등록하거나(사양서 7.5), 시간 정보가 있으면 주행 기록으로 가져온다(모션 없이 GPS만, 8.7) */
export async function importGpx(text: string, mode: 'course' | 'session', name: string): Promise<GpxImport> {
  const gpx = parseGpx(text);
  if (mode === 'course') {
    const c = courseFromGpx(gpx, { id: crypto.randomUUID(), name: name.trim() || gpx.name || 'GPX 코스' });
    const w = getSettings().gateWidthM;
    const course = { ...c, startGate: { ...c.startGate, widthM: w }, finishGate: { ...c.finishGate, widthM: w } };
    await saveCourseRecord(course);
    return { kind: 'course', course };
  }
  const gps = gpsSamplesFromGpx(gpx);
  const id = crypto.randomUUID();
  const startedAt = gps[0]!.tFix - gps[0]!.tRecv;
  const repo = getRepo();
  await repo.create({
    id,
    courseId: null,
    courseVersion: null,
    status: 'finished',
    startedAt,
    endedAt: startedAt + gps[gps.length - 1]!.tRecv,
    device: { os: 'GPX', browser: gpx.creator ?? 'GPX', userAgent: 'gpx-import', standalone: false },
    calibration: null,
    summary: null,
  });
  await repo.putChunk({ sessionId: id, seq: 0, gps, rawMotion: [], events: [{ t: 0, type: 'start' }] });
  await refreshSessions();
  void processSession(id);
  return { kind: 'session', sessionId: id };
}

/** 코스 → GPX 파일 (중심선, 없으면 출발·도착 두 점) */
export function courseGpxFile(c: Course): File {
  const safe = c.name.replace(/[\\/:*?"<>|\s]+/g, '_');
  return new File([courseToGpx(c)], `gachitayo_course_${safe}.gpx`, { type: 'application/gpx+xml' });
}

/** 지도 표시용: 구간 경계 위치 (코스 거리 m → 위경도) */
export function sectorMarks(c: Course): Array<{ at: LatLon; label: string }> {
  if (!c.centerline || !c.sectorBoundsM) return [];
  const pts = c.centerline.map(([lat, lon]) => toLocal(c.origin, lat, lon));
  const out: Array<{ at: LatLon; label: string }> = [];
  c.sectorBoundsM.forEach((b, i) => {
    let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      const d = Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.y - pts[k - 1]!.y);
      if (acc + d >= b) {
        const f = d > 0 ? (b - acc) / d : 0;
        const x = pts[k - 1]!.x + (pts[k]!.x - pts[k - 1]!.x) * f;
        const y = pts[k - 1]!.y + (pts[k]!.y - pts[k - 1]!.y) * f;
        out.push({ at: fromLocal(c.origin, x, y), label: `${i + 1}|${i + 2}` });
        break;
      }
      acc += d;
    }
  });
  return out;
}
