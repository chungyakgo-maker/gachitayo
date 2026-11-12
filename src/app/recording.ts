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
import { LiveStatsTracker, type LiveStatsSnapshot } from '../ui/recording/liveStats';

export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping';

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

let repo: SessionRepo | undefined;
export function getRepo(): SessionRepo {
  repo ??= createSessionRepo(new GachitayoDb());
  return repo;
}

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
      const interrupted = await recoverInterrupted(r);
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

  const stopGps = startGps(
    recorder.clock,
    (s) => {
      recorder.addGps(s);
      stats.addGps(s);
      if (state.locationPermission !== 'granted' || state.gpsError) {
        set({ locationPermission: 'granted', gpsError: null });
      }
    },
    (e) => set({ gpsError: e, ...(e === 'denied' ? { locationPermission: 'denied' as const } : {}) }),
  );

  const motionAllowed = motionPermission === 'granted' || motionPermission === 'not-needed';
  const stopMotion = motionAllowed
    ? startMotion(recorder.clock, (s) => {
        recorder.addMotion(s);
        stats.addMotion(s);
      })
    : () => {};

  void getWakeLock().acquire();

  // 화면이 가려지면(앱 전환, 화면 꺼짐, 전화) 바로 저장한다. 강제 종료돼도 잃는 데이터가 적다.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void recorder.pause();
    else recorder.unpause();
  };
  const onPageHide = () => void recorder.flush();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  const ticker = setInterval(emitActive, 500);

  active = {
    recorder,
    stats,
    teardown: () => {
      stopGps();
      stopMotion();
      clearInterval(ticker);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
  set({
    phase: 'recording',
    sessionId: recorder.sessionId,
    motionPermission,
    elapsedMs: 0,
    chunksSaved: 0,
    saveError: null,
    stats: stats.snapshot(0),
  });
  void refreshSessions();
}

/** "기록 시작" 버튼에서 부른다. 아이폰 모션 권한 요청이 탭 처리 안에서 바로 일어나야 한다. */
export function startRecording(): void {
  if (state.phase !== 'idle') return;
  const motionPromise = requestMotionPermission(); // await 전에 호출
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
      set({ phase: 'idle', error: `기록을 시작할 수 없습니다: ${message(e)}` });
    }
  })();
}

/** 중단된 기록을 이어서 한다. 버튼 탭 처리에서 부른다. */
export function resumeInterrupted(sessionId: string): void {
  if (state.phase !== 'idle') return;
  const motionPromise = requestMotionPermission(); // await 전에 호출
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

/** "기록 종료" 버튼 */
export async function stopRecording(): Promise<void> {
  if (!active || state.phase !== 'recording') return;
  const a = active;
  active = null;
  set({ phase: 'stopping' });
  a.teardown();
  try {
    await a.recorder.stop();
  } catch (e) {
    set({ error: `기록을 끝내는 중 오류: ${message(e)}` });
  }
  await getWakeLock().release();
  set({
    phase: 'idle',
    sessionId: null,
    chunksSaved: a.recorder.stats.chunksSaved,
    saveError: a.recorder.stats.lastError,
  });
  await refreshSessions();
}
