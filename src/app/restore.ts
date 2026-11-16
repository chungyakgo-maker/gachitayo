// 되살리기 (설계 docs/superpowers/specs/2026-11-13-kakao-login-design.md 5.7·5.7-1·5.7-2):
// 카카오 계정의 서버 기록 중 이 폰에 없는 것은 원본을 받아 같은 id로 다시 계산한다(예전 폰과 같은 랩).
// 서버 코스 중 기본 코스는 폰의 같은 기본 코스로 이어 붙이고, 이 폰에만 있는 기록은 원본이 있으면 올린다.
import { useSyncExternalStore } from 'react';
import { toLocal } from '../engine/geo';
import { ApiError, apiFetch } from '../server/api';
import { serverConfig } from '../server/config';
import { gunzipJson } from '../storage/gzip';
import { readRawFile } from '../storage/rawFile';
import { BUILTIN_COURSES } from '../courses/builtin';
import type { Course, CourseKind, CourseSource, Gate } from '../types/course';
import type { DeviceInfo, SessionRecord } from '../types/session';
import { getAuth } from './account';
import { loadCourses, processRestoredSession } from './drive';
import { getDriveRepo, getQueueRepo, getRecordingState, getRepo, refreshSessions, subscribeRecording } from './recording';
import { enqueueSessionUpload } from './sync';

export interface RestoreState {
  running: boolean;
  /** 이번에 되살린 기록 수 */
  done: number;
  /** 이번에 되살릴 기록 수 */
  total: number;
  /** 이번에 못 되살린 기록 수 (다음 실행 때 다시) */
  failed: number;
}

let state: RestoreState = { running: false, done: 0, total: 0, failed: 0 };
const listeners = new Set<() => void>();
function set(patch: Partial<RestoreState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getRestoreState = (): RestoreState => state;
export function useRestore(): RestoreState {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getRestoreState);
}

/** 기본 코스와 같은 코스로 볼 출발선 거리 */
const SAME_START_M = 30;

interface ServerCourse {
  id: string;
  name: string;
  kind: CourseKind;
  source: CourseSource;
  origin: { lat: number; lon: number };
  start_gate: Gate;
  finish_gate: Gate;
  centerline: Array<[number, number]> | null;
  length_m: number | null;
  sector_bounds_m: [number, number] | null;
  version: number;
  builtin?: string | null;
}
interface ServerSession {
  id: string;
  courseId: string | null;
  courseVersion: number | null;
  startedAt: string;
  endedAt: string | null;
  device: DeviceInfo | null;
  rawKey: string | null;
}

const toCourse = (c: ServerCourse): Course => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  source: c.source,
  origin: c.origin,
  startGate: c.start_gate,
  finishGate: c.finish_gate,
  centerline: c.centerline,
  lengthM: c.length_m,
  sectorBoundsM: c.sector_bounds_m,
  version: c.version,
  ...(c.builtin ? { builtin: c.builtin } : {}),
});

function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const p = toLocal(a, b.lat, b.lon);
  return Math.hypot(p.x, p.y);
}

/** 서버 코스가 폰의 어느 기본 코스인지 (키, 없으면 이름 + 출발선 30 m) */
function matchBuiltin(sc: ServerCourse, local: Course[]): Course | null {
  const builtins = local.filter((c) => c.builtin);
  if (sc.builtin) return builtins.find((c) => c.builtin === sc.builtin) ?? null;
  const names = new Set(BUILTIN_COURSES.map((b) => b.name));
  return builtins.find((c) => (c.name === sc.name || names.has(sc.name)) && distM(c.startGate, sc.start_gate) <= SAME_START_M) ?? null;
}

/** 녹화가 끝나면 이어서 한다 */
let wakeAfterRecording: (() => void) | null = null;
export function recordingSettled(): void {
  const w = wakeAfterRecording;
  wakeAfterRecording = null;
  w?.();
}
const recordingNow = () => getRecordingState().phase !== 'idle';
function untilIdle(): Promise<void> {
  return new Promise<void>((res) => {
    const unsub = subscribeRecording(() => {
      if (!recordingNow()) recordingSettled();
    });
    wakeAfterRecording = () => {
      unsub();
      res();
    };
  });
}

async function serverLists(token: string): Promise<{ courses: ServerCourse[]; sessions: ServerSession[] }> {
  const [courses, sessions] = await Promise.all([apiFetch<ServerCourse[]>('GET', '/api/courses', { token }), apiFetch<ServerSession[]>('GET', '/api/sessions', { token })]);
  return { courses, sessions };
}

/** 서버 계정에 없는 이 폰의 기록 (녹화 중 제외). 통신이 안 되면 던진다 */
export async function localOnlySessions(): Promise<SessionRecord[]> {
  const auth = getAuth();
  if (!auth) return (await getRepo().list()).filter((s) => s.status !== 'recording');
  const ids = new Set((await apiFetch<ServerSession[]>('GET', '/api/sessions', { token: auth.token })).map((s) => s.id));
  return (await getRepo().list()).filter((s) => s.status !== 'recording' && !ids.has(s.id));
}

async function restoreOne(s: ServerSession, userId: string, token: string, courseMap: Map<string, Course>): Promise<void> {
  const r = await fetch(`${serverConfig.apiUrl}/files/${userId}/${s.id}.raw.json.gz`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`원본을 받지 못했어요 (${r.status})`);
  const { gps, motion, events, channels } = readRawFile(await gunzipJson(new Uint8Array(await r.arrayBuffer())));
  const mapped = s.courseId ? courseMap.get(s.courseId) : undefined;
  const repo = getRepo();
  await repo.create({
    id: s.id,
    courseId: mapped ? mapped.id : s.courseId,
    courseVersion: mapped ? mapped.version : s.courseVersion,
    status: 'finished',
    startedAt: Date.parse(s.startedAt),
    endedAt: s.endedAt ? Date.parse(s.endedAt) : null,
    device: s.device ?? { os: '', browser: '', userAgent: '', standalone: false },
    calibration: null,
    summary: null,
    restoring: true,
  });
  try {
    await repo.putChunk({ sessionId: s.id, seq: 0, gps, rawMotion: motion, events, channels });
    if (!(await processRestoredSession(s.id))) throw new Error('다시 계산하지 못했어요');
    // 서버에 이미 있는 기록: 다시 올리지 않는다
    await repo.update(s.id, { status: 'uploaded', uploadedAt: Date.now(), restoring: false });
  } catch (e) {
    await getDriveRepo().deleteSession(s.id);
    throw e;
  }
}

async function run(): Promise<void> {
  const auth = getAuth();
  if (!auth || !serverConfig.apiUrl) return;
  // 주행 중에는 하지 않는다 (끝난 뒤 이어서)
  while (recordingNow()) await untilIdle();
  const { courses, sessions } = await serverLists(auth.token);

  // 1. 코스: 기본 코스는 폰의 것으로 이어 붙이고, 내 코스는 없거나 서버가 새것이면 넣는다
  const drive = getDriveRepo();
  const local = await drive.listCourses();
  const courseMap = new Map<string, Course>();
  let coursesChanged = false;
  for (const sc of courses) {
    const b = matchBuiltin(sc, local);
    if (b) {
      courseMap.set(sc.id, b);
      continue;
    }
    const have = local.find((c) => c.id === sc.id);
    if (!have || have.version < sc.version) {
      await drive.putCourse(toCourse(sc));
      coursesChanged = true;
    }
  }
  if (coursesChanged) await loadCourses();

  // 2. 서버에 있고 폰에 없는 기록 (새것부터). 지난번에 되살리다 앱이 꺼져 남은 것은 지우고 다시 받는다
  const repo = getRepo();
  for (const s of await repo.list()) if (s.restoring) await drive.deleteSession(s.id);
  const mine = new Set((await repo.list()).map((s) => s.id));
  const todo = sessions.filter((s) => !mine.has(s.id) && s.rawKey);
  set({ done: 0, total: todo.length, failed: 0 });
  for (const s of todo) {
    while (recordingNow()) await untilIdle();
    try {
      await restoreOne(s, auth.userId, auth.token, courseMap);
      set({ done: state.done + 1 });
    } catch (e) {
      set({ failed: state.failed + 1 });
      // 통신이 끊기면 나머지는 다음 기회에
      if (e instanceof TypeError) break;
    }
  }
  if (todo.length) await refreshSessions();

  // 3. 이 폰에서 계산했지만 한 번도 올리지 않은 기록은 이 계정으로 올린다 (대기열에 없을 때).
  //    다른 계정(끊긴 계정 등)에 올렸던 기록은 서버에서 그 계정 것이라 올릴 수 없고, 지운 기록이 되살아나면 안 되므로
  //    올리지 않는다(로그아웃 때 "이 폰에만 있는 기록"으로 알린다). 중단된 주행·계산 전 기록·가져온 기록도 건드리지 않는다
  const onServer = new Set(sessions.map((s) => s.id));
  const queued = new Set((await getQueueRepo().all()).map((q) => q.targetId));
  for (const s of await repo.list()) {
    if (s.status !== 'processed' || s.uploadedAt || s.imported || onServer.has(s.id) || queued.has(s.id)) continue;
    if (!(await drive.getResult(s.id))) continue;
    await enqueueSessionUpload(s.id);
  }
}

let running: Promise<void> | null = null;
/** 되살리기 (이미 도는 중이면 그것을 기다린다). 실패는 조용히 두고 다음 실행 때 다시 한다 */
export function startRestore(): Promise<void> {
  running ??= (async () => {
    set({ running: true });
    try {
      await run();
    } catch (e) {
      if (!(e instanceof ApiError) && !(e instanceof TypeError)) console.warn('되살리기 실패', e);
    } finally {
      set({ running: false });
      running = null;
    }
  })();
  return running;
}
