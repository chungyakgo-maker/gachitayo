// 되살리기 (설계 docs/superpowers/specs/2026-11-13-kakao-login-design.md 5.7·5.7-1·5.7-2) → 기록은 폰에만(2026-11-18 설계)에서는
// "처음 한 번 옮기기"로만 쓴다(migrateLocal.ts): 서버 기록 중 이 폰에 없는 것은 원본을 받아 같은 id로 다시 계산하고(예전 폰과 같은 랩),
// 폰에 있지만 원본이 정리된 기록(예전 앱은 올린 뒤 7일이면 지웠다) 중 최근 30개는 원본만 받아 둔다. 지우기 목록의 기록은 받지 않는다.
// 서버 코스 중 기본 코스는 폰의 같은 기본 코스로 이어 붙인다. (기록은 폰에만: 이 폰의 기록은 올리지 않는다)
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
import { RAW_KEEP } from './limits';
import { pendingServerDeletes } from './records';
import { pruneOldRaw } from './storageLimits';
import { loadCourses, processRestoredSession } from './drive';
import { getDriveRepo, getRecordingState, getRepo, refreshSessions, subscribeRecording } from './recording';

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

async function fetchRaw(id: string, userId: string, token: string) {
  const r = await fetch(`${serverConfig.apiUrl}/files/${userId}/${id}.raw.json.gz`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`원본을 받지 못했어요 (${r.status})`);
  return readRawFile(await gunzipJson(new Uint8Array(await r.arrayBuffer())));
}

async function restoreOne(s: ServerSession, userId: string, token: string, courseMap: Map<string, Course>): Promise<void> {
  const { gps, motion, events, channels } = await fetchRaw(s.id, userId, token);
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
  const gone = new Set(pendingServerDeletes().sessions);
  const todo = sessions.filter((s) => !mine.has(s.id) && !gone.has(s.id) && s.rawKey);
  // 폰에 있지만 원본이 없는 기록 중 최근 RAW_KEEP 개: 서버에 원본이 있으면 받아 둔다 (다시 재생·다시 계산되게)
  const withRaw = new Set(sessions.filter((s) => s.rawKey).map((s) => s.id));
  const recent = (await repo.list()).filter((s) => (s.status === 'processed' || s.status === 'uploaded') && !s.noRecord).sort((a, b) => b.startedAt - a.startedAt).slice(0, RAW_KEEP);
  const rawTodo: SessionRecord[] = [];
  for (const s of recent) if (s.uploadedAt && withRaw.has(s.id) && (await repo.chunks(s.id)).length === 0) rawTodo.push(s);
  set({ done: 0, total: todo.length + rawTodo.length, failed: 0 });
  for (const s of rawTodo) {
    while (recordingNow()) await untilIdle();
    try {
      const raw = await fetchRaw(s.id, auth.userId, auth.token);
      if ((await repo.chunks(s.id)).length === 0) await repo.putChunk({ sessionId: s.id, seq: 0, gps: raw.gps, rawMotion: raw.motion, events: raw.events, channels: raw.channels });
      if (s.rawPruned) await repo.update(s.id, { rawPruned: false });
      set({ done: state.done + 1 });
    } catch (e) {
      set({ failed: state.failed + 1 });
      if (e instanceof TypeError) break;
    }
  }
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
  await pruneOldRaw(repo);
  await refreshSessions();
}

let running: Promise<boolean> | null = null;
/** 되살리기 (이미 도는 중이면 그것을 기다린다). 실패는 조용히 두고 다음 실행 때 다시 한다. 하나도 빠짐없이 끝났으면 true */
export function startRestore(): Promise<boolean> {
  running ??= (async () => {
    set({ running: true });
    try {
      await run();
      return state.failed === 0;
    } catch (e) {
      if (!(e instanceof ApiError) && !(e instanceof TypeError)) console.warn('되살리기 실패', e);
      return false;
    } finally {
      set({ running: false });
      running = null;
    }
  })();
  return running;
}
