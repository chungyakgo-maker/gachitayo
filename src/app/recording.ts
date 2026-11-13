// 기록 컨트롤러: 센서 → 기록기 → 폰 저장소를 잇고, 화면에 보여줄 상태를 관리한다.
// 화면이 바뀌어도 기록이 이어지도록 모듈 하나(싱글턴)로 둔다.
import { useSyncExternalStore } from 'react';
import { createSessionClock } from '../normalize/sessionClock';
import { getDeviceInfo } from '../sensors/deviceInfo';
import { startGps, type GpsErrorKind } from '../sensors/gps';
import { requestMotionPermission, startMotion, type MotionPermission } from '../sensors/motion';
import { queryLocationPermission, type LocationPermission } from '../sensors/permissions';
import {
  createBrowserWakeLockManager,
  type WakeLockManager,
  type WakeLockState,
} from '../sensors/wakeLock';
import { GachitayoDb } from '../storage/db';
import {
  Recorder,
  finishInterrupted,
  recoverInterrupted,
  type RecorderDeps,
} from '../storage/recorder';
import { createSessionRepo, type SessionRepo } from '../storage/sessionRepo';
import type { DeviceInfo, SessionRecord } from '../types/session';
import type { GpsSample, RawMotionSample, SessionEventType } from '../types/samples';
import { createDriveRepo, type DriveRepo } from '../storage/driveRepo';
import { createQueueRepo, type QueueRepo } from '../storage/queueRepo';
import { LiveStatsTracker, type LiveStatsSnapshot } from '../ui/recording/liveStats';

/** stopFailed: 마지막 저장이 실패해 아직 끝내지 못함 (다시 저장을 누를 수 있음) */
export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'stopFailed';

export interface RecordingState {
  /** 앱 시작 점검(중단된 기록 찾기 등)이 끝났는지 */
  ready: boolean;
  phase: RecordingPhase;
  sessionId: string | null;
  elapsedMs: number;
  device: DeviceInfo | null;
  locationPermission: LocationPermission;
  /** 기록을 시작해야 알 수 있다 */
  motionPermission: MotionPermission | null;
  gpsError: GpsErrorKind | null;
  wakeLock: WakeLockState;
  /** 브라우저가 폰 저장소를 지우지 않게 영구 보관 허용을 받았는지 */
  persisted: boolean | null;
  chunksSaved: number;
  saveError: string | null;
  stats: LiveStatsSnapshot;
  /** 이어서 할지 물어볼 중단된 기록 */
  interrupted: SessionRecord[];
  sessions: SessionRecord[];
  error: string | null;
}

let state: RecordingState = {
  ready: false,
  phase: 'idle',
  sessionId: null,
  elapsedMs: 0,
  device: null,
  locationPermission: 'unknown',
  motionPermission: null,
  gpsError: null,
  wakeLock: 'off',
  persisted: null,
  chunksSaved: 0,
  saveError: null,
  stats: new LiveStatsTracker().snapshot(0),
  interrupted: [],
  sessions: [],
  error: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<RecordingState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const getRecordingState = (): RecordingState => state;

export function useRecording(): RecordingState {
  return useSyncExternalStore(subscribe, getRecordingState);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── 저장소, 화면 꺼짐 방지 ────────────────────────────────

let db: GachitayoDb | undefined;
const getDb = () => (db ??= new GachitayoDb());
let repo: SessionRepo | undefined;
export function getRepo(): SessionRepo {
  repo ??= createSessionRepo(getDb());
  return repo;
}
let driveRepo: DriveRepo | undefined;
export function getDriveRepo(): DriveRepo {
  driveRepo ??= createDriveRepo(getDb());
  return driveRepo;
}
let queueRepo: QueueRepo | undefined;
export function getQueueRepo(): QueueRepo {
  queueRepo ??= createQueueRepo(getDb());
  return queueRepo;
}

// ── 샘플 구독 (주행 중 계산이 기록기와 같은 센서 값을 받는다) ──

export type SampleEvent = { kind: 'gps'; s: GpsSample } | { kind: 'motion'; s: RawMotionSample };
const sampleListeners = new Set<(e: SampleEvent) => void>();

export function subscribeSamples(fn: (e: SampleEvent) => void): () => void {
  sampleListeners.add(fn);
  return () => sampleListeners.delete(fn);
}
const emitSample = (e: SampleEvent) => sampleListeners.forEach((l) => l(e));
/** 시험용: 기록기 없이 샘플을 흘려보낸다 */
export const __emitSampleForTest = emitSample;

let wakeLock: WakeLockManager | undefined;
function getWakeLock(): WakeLockManager {
  if (!wakeLock) {
    wakeLock = createBrowserWakeLockManager();
    const wl = wakeLock;
    wl.subscribe(() => set({ wakeLock: wl.getState() }));
  }
  return wakeLock;
}

async function requestPersist(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

// ── 다른 창과의 충돌 방지 (Web Locks) ─────────────────────
// 안드로이드에서는 크롬 탭과 설치한 앱이 같은 저장소를 쓴다. 한 창이 기록 중인 세션을
// 다른 창이 '중단됨'으로 보고 이어서 쓰지 않도록, 기록하는 동안 세션 이름으로 잠금을 잡는다.

const lockName = (sessionId: string) => `gachitayo-rec:${sessionId}`;

function holdSessionLock(sessionId: string): () => void {
  if (!navigator.locks?.request) return () => {};
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void navigator.locks.request(lockName(sessionId), () => held).catch(() => undefined);
  return release;
}

async function isLiveElsewhere(sessionId: string): Promise<boolean> {
  if (!navigator.locks?.query) return false;
  try {
    const snapshot = await navigator.locks.query();
    return (snapshot.held ?? []).some((l) => l.name === lockName(sessionId));
  } catch {
    return false;
  }
}

async function refreshSessions(): Promise<void> {
  set({ sessions: await getRepo().list() });
}

// ── 앱 시작 ──────────────────────────────────────────────

let initPromise: Promise<void> | undefined;

/** 앱 시작 때 한 번 부른다. 이전 실행에서 끝나지 않은 기록을 찾는다. */
export function initRecording(): Promise<void> {
  initPromise ??= (async () => {
    try {
      const r = getRepo();
      const interrupted = await recoverInterrupted(r, isLiveElsewhere);
      const [locationPermission, device, sessions, persisted] = await Promise.all([
        queryLocationPermission(),
        getDeviceInfo(),
        r.list(),
        navigator.storage?.persisted?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      set({ ready: true, interrupted, locationPermission, device, sessions, persisted });
    } catch (e) {
      set({ ready: true, error: `폰 저장소를 열 수 없습니다: ${message(e)}` });
    }
  })();
  return initPromise;
}

// ── 기록 중 ──────────────────────────────────────────────

interface Active {
  recorder: Recorder;
  stats: LiveStatsTracker;
  teardown: () => void;
}

let active: Active | null = null;

function emitActive(): void {
  if (!active) return;
  const now = active.recorder.clock.now();
  set({
    elapsedMs: now,
    stats: active.stats.snapshot(now),
    chunksSaved: active.recorder.stats.chunksSaved,
    saveError: active.recorder.stats.lastError,
  });
}

function recorderDeps(): RecorderDeps {
  return {
    repo: getRepo(),
    makeClock: (startedAt) =>
      createSessionClock(startedAt, () => performance.now(), () => Date.now()),
    onChange: emitActive,
  };
}

function begin(recorder: Recorder, motionPermission: MotionPermission): void {
  const stats = new LiveStatsTracker();
  const releaseLock = holdSessionLock(recorder.sessionId);

  const runGps = () =>
    startGps(
      recorder.clock,
      (s) => {
        recorder.addGps(s);
        stats.addGps(s);
        emitSample({ kind: 'gps', s });
        if (state.locationPermission !== 'granted' || state.gpsError) {
          set({ locationPermission: 'granted', gpsError: null });
        }
      },
      (e) => set({ gpsError: e, ...(e === 'denied' ? { locationPermission: 'denied' as const } : {}) }),
      // 아이폰 앱에서는 화면이 꺼지거나 앱을 내려도 기록이 이어지는 백그라운드 위치 (사양서 13.3)
      { background: true },
    );
  let stopGps = runGps();

  const motionAllowed = motionPermission === 'granted' || motionPermission === 'not-needed';
  const stopMotion = motionAllowed
    ? startMotion(recorder.clock, (s) => {
        recorder.addMotion(s);
        stats.addMotion(s);
        emitSample({ kind: 'motion', s });
      })
    : () => {};

  // 화면이 가려지면(앱 전환, 화면 꺼짐, 전화) 바로 저장한다. 강제 종료돼도 잃는 데이터가 적다.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      void recorder.pause();
      return;
    }
    recorder.unpause();
    // 백그라운드에 다녀온 뒤 위치 수신이 멈춰 있으면 다시 시작한다
    const since = stats.snapshot(recorder.clock.now()).secondsSinceGps;
    if (since === null || since > GPS_STALE_S) {
      stopGps();
      stopGps = runGps();
    }
  };
  const onPageHide = () => void recorder.flush();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  const ticker = setInterval(emitActive, 500);

  active = {
    recorder,
    stats,
    teardown: () => {
      releaseLock();
      stopGps();
      stopMotion();
      clearInterval(ticker);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
  set({ phase: 'recording', sessionId: recorder.sessionId, motionPermission, gpsError: null });
  emitActive();
  void refreshSessions();
}

/** 화면 복귀 때 마지막 위치 수신이 이보다 오래됐으면 위치 수신을 다시 시작한다 (초) */
const GPS_STALE_S = 5;

/** "기록 시작" 버튼에서 부른다. 아이폰 모션 권한 요청이 탭 처리 안에서 바로 일어나야 한다. */
export function startRecording(): void {
  if (state.phase !== 'idle') return;
  // 아이폰은 탭 처리 안에서 바로 요청해야 허용 창·화면 꺼짐 방지가 동작한다 (await 전에 호출)
  const motionPromise = requestMotionPermission();
  const wakeLockManager = getWakeLock();
  void wakeLockManager.acquire();
  set({ phase: 'starting', error: null, gpsError: null });
  void (async () => {
    try {
      await initRecording();
      const motionPermission = await motionPromise;
      const [device, persisted] = await Promise.all([getDeviceInfo(), requestPersist()]);
      set({ device, persisted });
      const recorder = await Recorder.start(recorderDeps(), {
        id: crypto.randomUUID(),
        startedAt: Date.now(),
        device,
      });
      begin(recorder, motionPermission);
    } catch (e) {
      void wakeLockManager.release();
      set({ phase: 'idle', error: `기록을 시작할 수 없습니다: ${message(e)}` });
    }
  })();
}

/** 중단된 기록을 이어서 한다. 버튼 탭 처리에서 부른다. */
export function resumeInterrupted(sessionId: string): void {
  if (state.phase !== 'idle') return;
  const motionPromise = requestMotionPermission(); // await 전에 호출
  const wakeLockManager = getWakeLock();
  void wakeLockManager.acquire();
  set({
    phase: 'starting',
    error: null,
    interrupted: state.interrupted.filter((s) => s.id !== sessionId),
  });
  void (async () => {
    try {
      const motionPermission = await motionPromise;
      set({ persisted: await requestPersist() });
      const recorder = await Recorder.resume(recorderDeps(), sessionId);
      begin(recorder, motionPermission);
    } catch (e) {
      void wakeLockManager.release();
      set({ phase: 'idle', error: `이어서 기록할 수 없습니다: ${message(e)}` });
    }
  })();
}

/** 중단된 기록을 이어서 하지 않고 끝낸다. */
export async function finishInterruptedSession(sessionId: string): Promise<void> {
  set({ interrupted: state.interrupted.filter((s) => s.id !== sessionId) });
  try {
    await finishInterrupted(getRepo(), sessionId);
  } catch (e) {
    set({ error: `기록을 끝낼 수 없습니다: ${message(e)}` });
  }
  await refreshSessions();
}

/** 기록 중인 세션 시계 (ms). 기록 중이 아니면 null */
export function recordingClockNow(): number | null {
  return active ? active.recorder.clock.now() : null;
}

/** 기록에 이벤트를 남긴다 (예: 주행 준비를 마치고 "기록 시작") */
export function markRecordingEvent(type: SessionEventType, payload?: Record<string, unknown>): void {
  active?.recorder.markEvent(type, payload);
}

/** 기록을 끝내고 지운다 (주행 준비에서 취소, 사양서 8.3) */
export async function discardRecording(): Promise<void> {
  // 아직 시작하는 중이면(권한 확인·세션 만들기) 끝날 때까지 기다렸다가 지운다. 안 그러면 나중에 혼자 기록이 시작된다
  if (state.phase === 'starting') {
    await new Promise<void>((resolve) => {
      const off = subscribe(() => {
        if (state.phase !== 'starting') {
          off();
          resolve();
        }
      });
    });
  }
  const a = active;
  if (!a) return;
  if (state.phase === 'recording') a.teardown();
  active = null;
  a.recorder.dispose();
  await a.recorder.idle();
  try {
    await getDriveRepo().deleteSession(a.recorder.sessionId);
  } catch (e) {
    set({ error: `기록을 지우지 못했습니다: ${message(e)}` });
  }
  await getWakeLock().release();
  set({ phase: 'idle', sessionId: null, chunksSaved: 0, saveError: null });
  await refreshSessions();
}

/**
 * "기록 종료" 버튼. 마지막 저장이 실패하면 기록을 끝내지 않고 stopFailed로 남는다.
 * 저장하지 못한 샘플은 메모리에 남아 있으므로, 공간을 확보한 뒤 다시 누르면 저장된다.
 */
export async function stopRecording(): Promise<string | null> {
  if (!active || (state.phase !== 'recording' && state.phase !== 'stopFailed')) return null;
  const a = active;
  if (state.phase === 'recording') a.teardown();
  set({ phase: 'stopping', error: null });
  try {
    await a.recorder.stop();
  } catch (e) {
    set({
      phase: 'stopFailed',
      saveError: a.recorder.stats.lastError,
      error: `${message(e)}. 저장하지 못한 기록은 아직 앱에 남아 있습니다. 폰 저장 공간을 확보한 뒤 "다시 저장"을 눌러 주세요. 앱을 닫으면 사라집니다.`,
    });
    return null;
  }
  active = null;
  await getWakeLock().release();
  set({
    phase: 'idle',
    sessionId: null,
    chunksSaved: a.recorder.stats.chunksSaved,
    saveError: null,
  });
  await refreshSessions();
  return a.recorder.sessionId;
}

export { refreshSessions };
