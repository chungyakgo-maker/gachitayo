// 주행 컨트롤러 (사양서 8.3~8.5): 주행 준비 → 주행 → 종료 → 주행 후 처리. 재생 모드(10.2)도 같은 주행 화면을 쓴다.
// 기록(센서·저장)은 app/recording이 맡고, 여기서는 같은 샘플을 주행 중 계산(LivePipeline)에 넣어 화면 스냅숏을 만든다.
import { getFriendsState } from './friends';
import { pushVirtualPoint, setVirtualFollow, startLiveLinks, stopLiveLinks } from './liveLink';
import { useSyncExternalStore } from 'react';
import { sortCourses } from '../courses/builtin';
import { nearestCourse } from '../engine/course/nearest';
import { LivePipeline, type LiveSnapshot } from '../engine/live/livePipeline';
import type { LiveRef } from '../engine/live/liveEngine';
import { processDrive } from '../engine/process/processDrive';
import { buildReplayTimeline, type ReplayTimeline } from './replayTimeline';
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
import { enqueueSessionUpload } from './sync';
import { changeProposedKind, loadRaw, processStoredSession, saveProposedCourse, type ProcessDeps } from './sessionProcessing';

export type DrivePhase = 'idle' | 'preparing' | 'driving' | 'ending';

/** 재생 정보 (사양서 10.2: 재생 막대) */
export interface ReplayInfo {
  label: string;
  speed: number;
  /** 끝에 닿아 멈췄다 */
  ended: boolean;
  playing: boolean;
  /** 지금 위치 (ms, 세션 시계) */
  posMs: number;
  endMs: number;
  /** 시작할 때 전부 계산하는 중이면 0~1, 아니면 null */
  preparing: number | null;
  /** 재생 막대로 옮길 수 있다 (가상 친구 따라가기만 아니다) */
  seekable: boolean;
  /** 끝내면 돌아갈 화면 */
  returnTo: string;
}

/** 배속 버튼 순서 (사양서 10.2) */
export const REPLAY_SPEEDS = [1, 5, 10, 20] as const;

export interface DriveState {
  phase: DrivePhase;
  /** 재생 모드면 재생 정보 */
  replay: ReplayInfo | null;
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
    const courses = sortCourses(await getDriveRepo().listCourses());
    set({ courses });
    // 고른 코스를 지웠으면 코스 없이 (코스 지우기)
    if (state.course && !courses.some((c) => c.id === state.course!.id)) await applyCourse(null, false);
    return courses;
  } catch (e) {
    set({ error: `코스를 불러오지 못했습니다: ${message(e)}` });
    return [];
  }
}

async function applyCourse(course: Course | null, chosen: boolean): Promise<void> {
  const refs = course ? await getDriveRepo().refLaps(course.id, course.version) : [];
  // 자동 감지가 늦게 끝났는데 그 사이 사용자가 코스를 골랐으면 버린다
  if (!chosen && state.courseChosen) return;
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
  // 재생 중이었으면 재생을 끝내고 시작한다
  if (state.replay) stopReplay(false);
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
  // 바로 고른 것으로 표시해, 그 사이 위치로 자동 감지한 코스가 덮어쓰지 않게 한다
  set({ course, courseChosen: true });
  void applyCourse(course, true);
}

/** 코스 상세의 "이 코스로 주행" (사용자 요청): 주행 준비를 열고 이 코스를 고른다 (이미 기록 중이면 준비 화면으로만) */
export function prepareWithCourse(course: Course): void {
  beginPrepare();
  if (state.phase === 'preparing') chooseCourse(course);
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
/** 앞 친구 받기·내 위치 보내기 (M9): 주행을 시작하거나 이어서 할 때 */
function startLinks(): void {
  const g = getSettings().gap;
  startLiveLinks({ friend: g.friendId ? { id: g.friendId, nickname: g.nickname ?? '앞 친구' } : null, publish: getFriendsState().sharing });
}

export function startDrive(): void {
  if (state.phase !== 'preparing') return;
  startLinks();
  markRecordingEvent('drive_start', state.course ? { courseId: state.course.id, courseVersion: state.course.version } : {});
  const id = getRecordingState().sessionId;
  if (id) void getRepo().update(id, { courseId: state.course?.id ?? null, courseVersion: state.course?.version ?? null });
  set({ phase: 'driving' });
  go('#/drive');
}

/** 주행 준비에서 뒤로: 기록을 지운다 */
export async function cancelPrepare(): Promise<void> {
  stopLiveLinks();
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
  stopLiveLinks();
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

/** 처리·코스 저장이 끝나면 서버에 올릴 차례에 넣는다 (사양서 5.4-4) */
async function andUpload<T>(sessionId: string, r: T | null): Promise<T | null> {
  if (r) void enqueueSessionUpload(sessionId);
  return r;
}

export async function processSession(sessionId: string, kind?: CourseKind): Promise<DriveResultRecord | null> {
  return andUpload(sessionId, await track(sessionId, () => processStoredSession(deps(), sessionId, kind)));
}

/** 되살린 기록 다시 계산 (카카오 로그인 되살리기): 서버에 이미 있으니 업로드 대기열에 넣지 않는다 */
export async function processRestoredSession(sessionId: string): Promise<DriveResultRecord | null> {
  return track(sessionId, () => processStoredSession(deps(), sessionId));
}

export async function changeKind(sessionId: string, kind: CourseKind): Promise<DriveResultRecord | null> {
  return andUpload(sessionId, await track(sessionId, () => changeProposedKind(deps(), sessionId, kind)));
}

export async function saveCourse(sessionId: string, name: string): Promise<boolean> {
  const r = await andUpload(sessionId, await track(sessionId, () => saveProposedCourse(deps(), sessionId, name)));
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
  startLinks();
  set({ phase: 'driving', replay: null, mode: getSettings().defaultMode });
  go('#/drive');
}

// ── 재생 모드 (사양서 10.2) ──────────────────────────────

export type ReplaySource = { kind: 'session'; id: string } | { kind: 'sim'; withRef: boolean } | { kind: 'friendSim' } | { kind: 'course'; course: Course };

let replayTimer: (() => void) | null = null;
/** 다 계산해 둔 재생 (재생 막대) */
let timeline: ReplayTimeline | null = null;
/** 가장 나중에 시작한 재생의 취소 표시 (끝내거나 새 재생을 시작하면 aborted) */
let activeReplay: { aborted: boolean } | null = null;

/** 코스 모의주행 (사용자 요청 "코스를 미리 보고 싶을 때"): 가상 차가 코스를 한 번 달린다. 비교 랩 없음, 5×로 시작 */
export function startCoursePreview(course: Course): Promise<void> {
  // 실제로 주행·기록 중이면 끊지 않고 준비 화면으로만 간다 (사양서 8.7, 검토 지적: 주행이 끊겨 끝낼 수 없었다)
  if ((state.phase !== 'idle' && !state.replay) || getRecordingState().phase !== 'idle') {
    go('#/prepare');
    return Promise.resolve();
  }
  return startReplay({ kind: 'course', course }, 5);
}

/** 재생 이름표 (준비 중에도 보이게 먼저 정한다) */
function replayLabel(src: ReplaySource): string {
  if (src.kind === 'course') return `모의주행 · ${src.course.name}`;
  if (src.kind === 'session') return '저장된 기록';
  if (src.kind === 'friendSim') return '가상 친구 따라가기';
  return src.withRef ? '가상 주행 (비교 랩 있음)' : '가상 주행 (첫 주행)';
}

function patchReplay(p: Partial<ReplayInfo>): void {
  if (state.replay) set({ replay: { ...state.replay, ...p } });
}

/** 0.1초마다: 재생 중이면 배속만큼 앞으로. 끝에 닿으면 그 자리에서 멈춘다 */
function stepPlayer(): void {
  const r = state.replay;
  if (!r || !timeline || !r.playing) return;
  const posMs = Math.min(r.endMs, r.posMs + 100 * r.speed);
  const ended = posMs >= r.endMs;
  patchReplay({ posMs, playing: !ended, ended });
  publish(timeline.frameAt(timeline.indexAt(posMs)));
}

/** 재생 막대로 옮기기: 그 시각 화면을 바로 보여 준다 (재생 중이면 거기서 계속) */
export function seekReplay(ms: number): void {
  const r = state.replay;
  if (!r || !timeline) return;
  const posMs = Math.min(Math.max(ms, 0), r.endMs);
  patchReplay({ posMs, ended: false });
  publish(timeline.frameAt(timeline.indexAt(posMs)));
}

/** 멈춤·재생. 끝난 뒤 재생하면 처음부터 */
export function setReplayPlaying(on: boolean): void {
  const r = state.replay;
  if (!r || !timeline) return;
  if (on && (r.ended || r.posMs >= r.endMs)) {
    patchReplay({ posMs: 0, ended: false, playing: true });
    publish(timeline.frameAt(0));
    return;
  }
  patchReplay({ playing: on, ended: false });
}

/** 배속 버튼: 1× → 5× → 10× → 20× → 1× */
export function cycleReplaySpeed(): void {
  const r = state.replay;
  if (!r) return;
  const i = REPLAY_SPEEDS.findIndex((v) => v === r.speed);
  patchReplay({ speed: REPLAY_SPEEDS[(i + 1) % REPLAY_SPEEDS.length]! });
}

/** 저장된 세션이나 가상 주행을 주행 화면에 배속으로 흘려보낸다 (기록·저장 없음) */
export async function startReplay(src: ReplaySource, speed: number): Promise<void> {
  stopReplay(false);
  set({ error: null });
  // 이 재생의 취소 표시: 준비 중에 끝내거나 다른 재생을 시작하면(버튼 두 번 누름 등) true. 기다린 뒤마다 확인한다
  const signal = { aborted: false };
  activeReplay = signal;
  const returnTo = src.kind === 'course' ? `#/course/${src.course.id}` : '#/dev/replay';
  try {
    if (src.kind !== 'friendSim') {
      // 누르자마자 "준비 중"으로 주행 화면에 간다. 가상 주행 데이터 만들기·기록 읽기·계산은 그다음 (화면이 멈춰 보이지 않게)
      set({
        phase: 'driving',
        replay: { label: replayLabel(src), speed, ended: false, playing: false, posMs: 0, endMs: 0, preparing: 0, seekable: true, returnTo },
        course: src.kind === 'course' ? src.course : null,
        courseChosen: true,
        refs: [],
        ref: null,
        mode: getSettings().defaultMode,
      });
      publish(null);
      go('#/drive');
      await new Promise((r) => setTimeout(r, 0));
      if (signal.aborted) return;
    }
    let gps: GpsSample[];
    let motion: RawMotionSample[];
    let course: Course | null = null;
    let ref: RefLapRecord | null = null;
    let label: string;
    let friendFeed: { points: Array<{ t: number; lat: number; lon: number; speed: number; heading: null; hAcc: number }>; lagMs: number; startEpochMs: number } | null = null;
    if (src.kind === 'friendSim') {
      // 가상 친구 따라가기 (사용자 요청): 앞 친구 '지훈(가상)'의 위치를 1초마다, 0.8초 늦게 넣는다
      const sim = await import('../sim');
      const sc = sim.friendScenario();
      gps = sc.gps;
      motion = sc.motion;
      friendFeed = { points: sc.friend, lagMs: sc.lagMs, startEpochMs: sc.startEpochMs };
      label = '가상 친구 따라가기';
    } else if (src.kind === 'course') {
      const sim = await import('../sim');
      const d = sim.simulateCourseDrive(src.course);
      gps = d.gps;
      motion = d.motion;
      course = src.course;
      label = `모의주행 · ${src.course.name}`;
    } else if (src.kind === 'session') {
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
    if (signal.aborted) return;
    if (gps.length === 0) throw new Error('GPS 기록이 없어 재생할 수 없습니다');
    gps = [...gps].sort((a, b) => a.tRecv - b.tRecv);
    motion = [...motion].sort((a, b) => a.t - b.t);
    const end = Math.max(gps.at(-1)!.tRecv, motion.at(-1)?.t ?? 0);
    const info: ReplayInfo = { label, speed, ended: false, playing: true, posMs: 0, endMs: end, preparing: null, seekable: friendFeed === null, returnTo };
    if (friendFeed === null) {
      // 시작할 때 전부 계산해 두고(준비 중), 막대·배속으로 꺼내 보여 준다 (사양서 10.2)
      set({ replay: { ...info, playing: false, preparing: 0 }, course, refs: ref ? [ref] : [], ref });
      const tl = await buildReplayTimeline({ gps, motion, course, ref: toLiveRef(ref) }, { signal, onProgress: (f) => !signal.aborted && patchReplay({ preparing: f }) });
      if (signal.aborted) return;
      timeline = tl;
      patchReplay({ preparing: null, playing: true, endMs: tl.endMs });
      publish(tl.frameAt(0));
      const timer = setInterval(stepPlayer, 100);
      replayTimer = () => clearInterval(timer);
      return;
    }
    pipeline = new LivePipeline({ course: null, ref: null });
    pipeline.setCourse(course, toLiveRef(ref));
    set({ phase: 'driving', replay: info, course, courseChosen: true, refs: ref ? [ref] : [], ref, mode: getSettings().defaultMode });
    publish(null);
    setVirtualFollow(friendFeed !== null);
    let simT = 0;
    let i = 0;
    let j = 0;
    let k = 0;
    const id = setInterval(() => {
      if (!pipeline) return;
      simT = Math.min(end, simT + 100 * speed);
      while (i < gps.length && gps[i]!.tRecv <= simT) pipeline.pushGps(gps[i++]!);
      while (j < motion.length && motion[j]!.t <= simT) pipeline.pushMotion(motion[j++]!);
      if (friendFeed)
        while (k < friendFeed.points.length && friendFeed.points[k]!.t - friendFeed.startEpochMs <= simT - friendFeed.lagMs) pushVirtualPoint(friendFeed.points[k++]!);
      publish(pipeline.tick(simT));
      patchReplay({ posMs: simT });
      if (simT >= end) {
        clearInterval(id);
        patchReplay({ ended: true, playing: false });
      }
    }, 100);
    replayTimer = () => clearInterval(id);
    go('#/drive');
  } catch (e) {
    // 준비 중에 끝냈으면(취소) 알릴 것이 없다
    if (signal.aborted) return;
    // 준비 중이었으면 "준비 중"을 지우고 오류만 보인다 (길게 눌러 끝내면 돌아간다)
    patchReplay({ preparing: null, playing: false });
    set({ error: `재생할 수 없습니다: ${message(e)}` });
  }
}

export function stopReplay(navigate = true): void {
  replayTimer?.();
  replayTimer = null;
  if (activeReplay) activeReplay.aborted = true;
  activeReplay = null;
  timeline = null;
  setVirtualFollow(false);
  if (!state.replay) return;
  const back = state.replay.returnTo;
  pipeline = null;
  publish(null);
  set({ phase: 'idle', replay: null, course: null, ref: null, refs: [] });
  if (navigate) go(back);
}
