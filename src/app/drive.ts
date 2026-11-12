// 주행 컨트롤러 (사양서 8.3~8.5): 주행 준비 → 주행 → 종료 → 주행 후 처리. 재생 모드(10.2)도 같은 주행 화면을 쓴다.
// 기록(센서·저장)은 app/recording이 맡고, 여기서는 같은 샘플을 주행 중 계산(LivePipeline)에 넣어 화면 스냅숏을 만든다.
import { useSyncExternalStore } from 'react';
import { nearestCourse } from '../engine/course/nearest';
import { LivePipeline, type LiveSnapshot } from '../engine/live/livePipeline';
import type { LiveRef } from '../engine/live/liveEngine';
import { processDrive } from '../engine/process/processDrive';
import type { Course, CourseKind } from '../types/course';
import type { DriveResultRecord, RefLapRecord } from '../types/drive';
import type { GpsSample, RawMotionSample } from '../types/samples';
import {
  discardRecording,
  getDriveRepo,
  getRecordingState,
  getRepo,
  markRecordingEvent,
  recordingClockNow,
  refreshSessions,
  resumeInterrupted,
  startRecording,
  stopRecording,
  subscribeSamples,
} from './recording';
import { getSettings, type DriveMode } from './settings';
import { changeProposedKind, loadRaw, processStoredSession, saveProposedCourse, type ProcessDeps } from './sessionProcessing';

export type DrivePhase = 'idle' | 'preparing' | 'driving' | 'ending';

export interface DriveState {
  phase: DrivePhase;
  /** 재생 모드면 재생 정보 */
  replay: { label: string; speed: number; ended: boolean } | null;
  courses: Course[];
  course: Course | null;
  /** 사용자가 직접 골랐으면 더는 자동 감지로 바꾸지 않는다 */
  courseChosen: boolean;
  refs: RefLapRecord[];
  ref: RefLapRecord | null;
  mode: DriveMode;
  error: string | null;
}

let state: DriveState = {
  phase: 'idle',
  replay: null,
  courses: [],
  course: null,
  courseChosen: false,
  refs: [],
  ref: null,
  mode: getSettings().defaultMode,
  error: null,
};
const listeners = new Set<() => void>();
function set(patch: Partial<DriveState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getDriveState = (): DriveState => state;
export function useDrive(): DriveState {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getDriveState);
}

// ── 화면 스냅숏 (10 Hz) ────────────────────────────────

let live: LiveSnapshot | null = null;
const liveListeners = new Set<() => void>();
function publish(s: LiveSnapshot | null): void {
  live = s;
  liveListeners.forEach((l) => l());
}
export const getLiveSnapshot = (): LiveSnapshot | null => live;
export function useLiveSnapshot(): LiveSnapshot | null {
  return useSyncExternalStore((cb) => {
    liveListeners.add(cb);
    return () => liveListeners.delete(cb);
  }, getLiveSnapshot);
}

// ── 공통 ──────────────────────────────────────────────

const go = (hash: string) => {
  window.location.hash = hash;
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toLiveRef = (r: RefLapRecord | null): LiveRef | null =>
  r ? { trace: r.trace, lapTimeMs: r.lapTimeMs, sectorTimesMs: r.sectorTimesMs } : null;

let pipeline: LivePipeline | null = null;
let teardownLive: (() => void) | null = null;

export async function loadCourses(): Promise<Course[]> {
  try {
    const courses = await getDriveRepo().listCourses();
    set({ courses });
    return courses;
  } catch (e) {
    set({ error: `코스를 불러오지 못했습니다: ${message(e)}` });
    return [];
  }
}

async function applyCourse(course: Course | null, chosen: boolean): Promise<void> {
  const refs = course ? await getDriveRepo().refLaps(course.id, course.version) : [];
  const ref = refs[0] ?? null;
  set({ course, courseChosen: chosen || state.courseChosen, refs, ref });
  pipeline?.setCourse(course, toLiveRef(ref));
}

function startTicker(now: () => number | null): () => void {
  const id = setInterval(() => {
    const t = now();
    if (t !== null && pipeline) publish(pipeline.tick(t));
  }, 100);
  return () => clearInterval(id);
}

// ── 주행 준비 ──────────────────────────────────────────

/** 메인의 "주행 시작". 아이폰 모션 권한 요청이 탭 처리 안에서 일어나야 하므로 버튼 onClick에서 바로 부른다 */
export function beginPrepare(): void {
  if (state.phase !== 'idle' || getRecordingState().phase !== 'idle') {
    go('#/prepare');
    return;
  }
  startRecording();
  pipeline = new LivePipeline({ course: null, ref: null });
  set({ phase: 'preparing', replay: null, course: null, courseChosen: false, refs: [], ref: null, mode: getSettings().defaultMode, error: null });
  publish(null);
  void loadCourses();
  let detecting = false;
  const unsub = subscribeSamples((e) => {
    if (!pipeline) return;
    if (e.kind === 'motion') {
      pipeline.pushMotion(e.s);
      return;
    }
    pipeline.pushGps(e.s);
    // 현재 위치로 코스 자동 감지 (사양서 8.3). 사용자가 고르기 전까지만
    if (!state.courseChosen && !detecting && state.phase === 'preparing') {
      const near = nearestCourse(state.courses, e.s.lat, e.s.lon)?.course ?? null;
      if (near?.id !== state.course?.id) {
        detecting = true;
        void applyCourse(near, false).finally(() => {
          detecting = false;
        });
      }
    }
  });
  const stopTicker = startTicker(recordingClockNow);
  teardownLive = () => {
    unsub();
    stopTicker();
  };
  go('#/prepare');
}

export function chooseCourse(course: Course | null): void {
  void applyCourse(course, true);
}

export function chooseRef(ref: RefLapRecord): void {
  set({ ref });
  pipeline?.setCourse(state.course, toLiveRef(ref));
}

export function setDriveMode(mode: DriveMode): void {
  set({ mode });
}

const MODES: DriveMode[] = ['map', 'minimal', 'dashboard'];
export function cycleDriveMode(): void {
  set({ mode: MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]! });
}

/** 주행 준비의 "기록 시작" */
export function startDrive(): void {
  if (state.phase !== 'preparing') return;
  markRecordingEvent('drive_start', state.course ? { courseId: state.course.id, courseVersion: state.course.version } : {});
  const id = getRecordingState().sessionId;
  if (id) void getRepo().update(id, { courseId: state.course?.id ?? null, courseVersion: state.course?.version ?? null });
  set({ phase: 'driving' });
  go('#/drive');
}

/** 주행 준비에서 뒤로: 기록을 지운다 */
export async function cancelPrepare(): Promise<void> {
  teardownLive?.();
  teardownLive = null;
  pipeline = null;
  publish(null);
  set({ phase: 'idle' });
  go('#/');
  await discardRecording();
}

// ── 주행 종료와 주행 후 처리 ─────────────────────────────

/** "길게 눌러 종료" */
export async function endDrive(): Promise<void> {
  if (state.replay) {
    stopReplay();
    return;
  }
  if (state.phase !== 'driving' && state.phase !== 'ending') return;
  set({ phase: 'ending', error: null });
  teardownLive?.();
  teardownLive = null;
  const id = await stopRecording();
  if (!id) {
    // 저장 실패: 기록 상태(stopFailed)에 "다시 저장" 안내가 있다
    set({ error: getRecordingState().error ?? '기록을 끝내지 못했습니다' });
    return;
  }
  pipeline = null;
  set({ phase: 'idle' });
  go(`#/summary/${id}`);
  void processSession(id);
}

/** 기록을 끝내지 못했을 때 "다시 저장" */
export async function retryEndDrive(): Promise<void> {
  await endDrive();
}

export type ProcessingStatus = { state: 'running' } | { state: 'error'; error: string } | { state: 'done' };
const processing = new Map<string, ProcessingStatus>();
const procListeners = new Set<() => void>();
let procVersion = 0;
function setProcessing(id: string, s: ProcessingStatus): void {
  processing.set(id, s);
  procVersion++;
  procListeners.forEach((l) => l());
}
export function useProcessing(sessionId: string): ProcessingStatus | null {
  useSyncExternalStore(
    (cb) => {
      procListeners.add(cb);
      return () => procListeners.delete(cb);
    },
    () => procVersion,
  );
  return processing.get(sessionId) ?? null;
}

const deps = (): ProcessDeps => ({ sessions: getRepo(), drive: getDriveRepo() });

async function track<T>(sessionId: string, work: () => Promise<T>): Promise<T | null> {
  setProcessing(sessionId, { state: 'running' });
  try {
    const r = await work();
    setProcessing(sessionId, { state: 'done' });
    await refreshSessions();
    return r;
  } catch (e) {
    setProcessing(sessionId, { state: 'error', error: message(e) });
    return null;
  }
}

export function processSession(sessionId: string, kind?: CourseKind): Promise<DriveResultRecord | null> {
  return track(sessionId, () => processStoredSession(deps(), sessionId, kind));
}

export function changeKind(sessionId: string, kind: CourseKind): Promise<DriveResultRecord | null> {
  return track(sessionId, () => changeProposedKind(deps(), sessionId, kind));
}

export async function saveCourse(sessionId: string, name: string): Promise<boolean> {
  const r = await track(sessionId, () => saveProposedCourse(deps(), sessionId, name));
  if (r) await loadCourses();
  return r !== null;
}

// ── 중단된 주행 이어서 하기 (사양서 9장) ─────────────────

export async function resumeDrive(sessionId: string): Promise<void> {
  resumeInterrupted(sessionId);
  const session = await getRepo().get(sessionId);
  const courses = await loadCourses();
  const course = courses.find((c) => c.id === session?.courseId) ?? null;
  pipeline = new LivePipeline({ course: null, ref: null });
  await applyCourse(course, true);
  const unsub = subscribeSamples((e) => (e.kind === 'gps' ? pipeline?.pushGps(e.s) : pipeline?.pushMotion(e.s)));
  const stopTicker = startTicker(recordingClockNow);
  teardownLive = () => {
    unsub();
    stopTicker();
  };
  set({ phase: 'driving', replay: null, mode: getSettings().defaultMode });
  go('#/drive');
}

// ── 재생 모드 (사양서 10.2) ──────────────────────────────

export type ReplaySource = { kind: 'session'; id: string } | { kind: 'sim'; withRef: boolean };

let replayTimer: (() => void) | null = null;

/** 저장된 세션이나 가상 주행을 주행 화면에 배속으로 흘려보낸다 (기록·저장 없음) */
export async function startReplay(src: ReplaySource, speed: number): Promise<void> {
  stopReplay(false);
  set({ error: null });
  try {
    let gps: GpsSample[];
    let motion: RawMotionSample[];
    let course: Course | null = null;
    let ref: RefLapRecord | null = null;
    let label: string;
    if (src.kind === 'session') {
      const raw = await loadRaw(getRepo(), src.id);
      const session = await getRepo().get(src.id);
      gps = raw.gps;
      motion = raw.motion;
      const courses = await loadCourses();
      course = courses.find((c) => c.id === session?.courseId) ?? null;
      if (course) ref = (await getDriveRepo().bestRefLap(course.id, course.version)) ?? null;
      label = '저장된 기록';
    } else {
      const sim = await import('../sim');
      const oval = sim.stadiumTrack();
      const drive = (k: number) => ({ laps: 3, startStopS: 5, endStopS: 3, vMax: 40 * k, aLatMax: 8 * k * k, aAccel: 3 * k * k, aBrake: 6 * k * k });
      if (src.withRef) {
        // 첫 가상 주행으로 코스와 베스트를 만들고(저장하지 않음), 2% 느린 두 번째 주행을 재생한다
        const first = sim.synthesizeSensors(sim.simulateDrive(oval, drive(1)), { ...sim.defaultSensorOpts, seed: 7 });
        const r = processDrive({ gps: first.gps, motion: first.motion, events: [{ t: 0, type: 'start' }], course: null, newCourse: { id: 'sim', name: '가상 오벌' } });
        course = r.course;
        if (course && r.bestLap) {
          ref = {
            id: 'sim:best',
            courseId: course.id,
            courseVersion: course.version,
            sessionId: 'sim',
            lapNo: r.bestLap.lapNo,
            startedAt: Date.now(),
            lapTimeMs: r.bestLap.lapTimeMs,
            sectorTimesMs: r.bestLap.sectorTimesMs,
            trace: r.bestLap.trace,
          };
        }
      }
      const s = sim.synthesizeSensors(sim.simulateDrive(oval, drive(src.withRef ? 0.98 : 1)), { ...sim.defaultSensorOpts, seed: 8 });
      gps = s.gps;
      motion = s.motion;
      label = src.withRef ? '가상 주행 (비교 랩 있음)' : '가상 주행 (첫 주행)';
    }
    if (gps.length === 0) throw new Error('GPS 기록이 없어 재생할 수 없습니다');
    gps = [...gps].sort((a, b) => a.tRecv - b.tRecv);
    motion = [...motion].sort((a, b) => a.t - b.t);
    const end = Math.max(gps.at(-1)!.tRecv, motion.at(-1)?.t ?? 0);
    pipeline = new LivePipeline({ course: null, ref: null });
    pipeline.setCourse(course, toLiveRef(ref));
    set({ phase: 'driving', replay: { label, speed, ended: false }, course, courseChosen: true, refs: ref ? [ref] : [], ref, mode: getSettings().defaultMode });
    publish(null);
    let simT = 0;
    let i = 0;
    let j = 0;
    const id = setInterval(() => {
      if (!pipeline) return;
      simT = Math.min(end, simT + 100 * speed);
      while (i < gps.length && gps[i]!.tRecv <= simT) pipeline.pushGps(gps[i++]!);
      while (j < motion.length && motion[j]!.t <= simT) pipeline.pushMotion(motion[j++]!);
      publish(pipeline.tick(simT));
      if (simT >= end) {
        clearInterval(id);
        set({ replay: state.replay ? { ...state.replay, ended: true } : null });
      }
    }, 100);
    replayTimer = () => clearInterval(id);
    go('#/drive');
  } catch (e) {
    set({ error: `재생할 수 없습니다: ${message(e)}` });
  }
}

export function stopReplay(navigate = true): void {
  replayTimer?.();
  replayTimer = null;
  if (!state.replay) return;
  pipeline = null;
  publish(null);
  set({ phase: 'idle', replay: null, course: null, ref: null, refs: [] });
  if (navigate) go('#/dev/replay');
}
