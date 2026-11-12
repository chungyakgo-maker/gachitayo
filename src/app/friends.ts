// 친구 위치 공유 (사양서 8.2·8.8, M8: 사용자 요청으로 2단계에서 앞당김)
// - 친구 코드로 바로 서로 친구. 끊으면 양쪽 모두
// - 내 위치는 내가 공유를 켠 동안, 앱이 화면에 보일 때만 5초마다 보낸다. 앱을 다시 열면 꺼져 있다
// - 메인 지도가 보일 때 5초마다 공유 중인 친구 위치를 받아 온다 (서버는 2분 안에 받은 위치만 준다)
import { useSyncExternalStore } from 'react';
import { ApiError, apiFetch } from '../server/api';
import { friendlyServerError, getAuth, markAccountLost, subscribeAccount } from './account';
import { startGps } from '../sensors/gps';
import { subscribeSamples } from './recording';

export interface Friend {
  userId: string;
  nickname: string;
  since: string;
  /** 지금 위치를 공유하는 중 */
  sharing: boolean;
}

export interface FriendPos {
  userId: string;
  nickname: string;
  lat: number;
  lon: number;
  hAcc: number | null;
  heading: number | null;
  speed: number | null;
  /** 받은 순간 서버 기준으로 몇 ms 전 위치인지 */
  ageMs: number;
}

export interface MyFix {
  lat: number;
  lon: number;
  hAcc: number;
  heading?: number | null;
  speed?: number | null;
  /** 받은 시각 (Date.now) */
  at: number;
}

export interface FriendsState {
  /** 서버 계정이 있어 친구 기능을 쓸 수 있는지 */
  available: boolean;
  code: string | null;
  friends: Friend[];
  loaded: boolean;
  busy: boolean;
  error: string | null;
  /** 친구 추가 결과 안내 */
  notice: string | null;
  /** 내 위치를 공유하는 중 (앱을 다시 열면 꺼짐) */
  sharing: boolean;
  lastSentAt: number | null;
  positions: FriendPos[];
}

export const SEND_INTERVAL_MS = 5000;
export const POLL_INTERVAL_MS = 5000;
/** 이보다 오래된 내 위치는 보내지 않는다 (GPS가 끊김) */
const MY_FIX_MAX_AGE_MS = 30_000;

let state: FriendsState = {
  available: getAuth() !== null,
  code: null,
  friends: [],
  loaded: false,
  busy: false,
  error: null,
  notice: null,
  sharing: false,
  lastSentAt: null,
  positions: [],
};
const listeners = new Set<() => void>();
function set(patch: Partial<FriendsState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getFriendsState = (): FriendsState => state;
export function subscribeFriends(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function useFriends(): FriendsState {
  return useSyncExternalStore(subscribeFriends, getFriendsState);
}

/** 'K7P2Q9XM' → 'K7P2-Q9XM' */
export const formatCode = (c: string) => (c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const auth = getAuth();
  if (!auth) throw new Error('서버 계정이 있어야 해요');
  try {
    return await apiFetch<T>(method, path, { token: auth.token, body });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) markAccountLost();
    throw e;
  }
}

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export async function loadFriends(): Promise<void> {
  if (!getAuth()) {
    set({ available: false });
    return;
  }
  set({ available: true, busy: true, error: null });
  try {
    const r = await call<{ code: string; friends: Friend[] }>('GET', '/api/friends');
    set({ code: r.code, friends: r.friends, loaded: true, busy: false });
  } catch (e) {
    set({ busy: false, error: friendlyServerError(e) });
  }
}

/** 친구 코드로 친구 맺기. 성공하면 true */
export async function addFriendByCode(code: string): Promise<boolean> {
  const c = code.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== 8) {
    set({ error: '친구 코드는 8자리예요 (예: K7P2-Q9XM)', notice: null });
    return false;
  }
  set({ busy: true, error: null, notice: null });
  try {
    const r = await call<{ nickname: string; already: boolean }>('POST', '/api/friends', { code: c });
    set({ notice: r.already ? `${r.nickname} 님은 이미 친구예요` : `${r.nickname} 님과 친구가 됐어요` });
    await loadFriends();
    return true;
  } catch (e) {
    const msg = e instanceof ApiError && (e.status === 404 || e.status === 400) ? e.message : friendlyServerError(e);
    set({ busy: false, error: msg });
    return false;
  }
}

export async function removeFriend(userId: string): Promise<void> {
  set({ busy: true, error: null, notice: null });
  try {
    await call('DELETE', `/api/friends/${userId}`);
    set({ positions: state.positions.filter((p) => p.userId !== userId) });
    await loadFriends();
  } catch (e) {
    set({ busy: false, error: friendlyServerError(e) });
  }
}

// ── 내 위치 보내기 ────────────────────────────────

let myFix: MyFix | null = null;
let sendTimer: ReturnType<typeof setInterval> | null = null;
let sending = false;
let stopGps: (() => void) | null = null;

type GpsStarter = (onFix: (f: MyFix) => void, onDenied: () => void) => () => void;
/** 공유하는 동안 위치를 받는다 (어느 탭에 있어도). 주행 중이면 기록의 GPS도 함께 들어온다 */
let gpsStarter: GpsStarter = (onFix, onDenied) =>
  startGps(
    { now: () => performance.now() },
    (s) => onFix({ lat: s.lat, lon: s.lon, hAcc: s.hAcc, heading: s.heading, speed: s.speed, at: Date.now() }),
    (e) => {
      if (e === 'denied') onDenied();
    },
  );
export function setGpsStarterForTest(f: GpsStarter): void {
  gpsStarter = f;
}

/** 메인 화면 위치 미리보기와 주행 기록의 GPS가 알려 준다 */
export function reportMyFix(fix: MyFix): void {
  myFix = fix;
}

async function sendOnce(now = Date.now()): Promise<void> {
  if (!state.sharing || sending || !isVisible() || !myFix || now - myFix.at > MY_FIX_MAX_AGE_MS) return;
  sending = true;
  try {
    const f = myFix;
    await call('PUT', '/api/presence', {
      lat: f.lat,
      lon: f.lon,
      hAcc: Math.round(f.hAcc * 10) / 10,
      heading: f.heading ?? null,
      speed: f.speed === null || f.speed === undefined ? null : Math.max(0, f.speed),
    });
    set({ lastSentAt: now, error: null });
  } catch (e) {
    set({ error: friendlyServerError(e) });
  } finally {
    sending = false;
  }
}

export async function setSharing(on: boolean): Promise<void> {
  if (on === state.sharing) return;
  set(on ? { sharing: true, error: null } : { sharing: false });
  if (on) {
    stopGps ??= gpsStarter(reportMyFix, () => {
      set({ error: '위치 권한이 꺼져 있어 공유할 수 없어요. 폰 설정에서 위치를 허용해 주세요' });
      void setSharing(false);
    });
    sendTimer ??= setInterval(() => void sendOnce(), SEND_INTERVAL_MS);
    await sendOnce();
  } else {
    if (sendTimer) clearInterval(sendTimer);
    sendTimer = null;
    stopGps?.();
    stopGps = null;
    set({ lastSentAt: null });
    try {
      await call('DELETE', '/api/presence');
    } catch {
      // 못 지워도 2분 뒤에는 친구에게 보이지 않는다
    }
  }
}

// ── 친구 위치 받아 오기 ────────────────────────────

let watchers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function pollOnce(): Promise<void> {
  if (!getAuth() || !isVisible()) return;
  try {
    const list = await call<FriendPos[]>('GET', '/api/friends/presence');
    set({ positions: list });
  } catch {
    // 다음 차례에 다시
  }
}

/** 메인 지도가 보이는 동안 친구 위치를 받아 온다. 멈추는 함수를 돌려준다 */
export function watchFriendPositions(): () => void {
  watchers++;
  if (watchers === 1) {
    void pollOnce();
    pollTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  }
  return () => {
    watchers--;
    if (watchers === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

let started = false;
/** 앱 시작 때 한 번: 주행 기록의 GPS도 내 위치로 쓴다, 계정이 생기면 친구 기능을 켠다 */
export function initFriends(): void {
  if (started) return;
  started = true;
  subscribeSamples((e) => {
    if (e.kind === 'gps') reportMyFix({ lat: e.s.lat, lon: e.s.lon, hAcc: e.s.hAcc, heading: e.s.heading, speed: e.s.speed, at: Date.now() });
  });
  subscribeAccount(() => {
    const ok = getAuth() !== null;
    if (ok !== state.available) set({ available: ok });
    if (!ok && state.sharing) void setSharing(false);
  });
  if (typeof document !== 'undefined') {
    // 화면이 다시 보이면 바로 한 번 보낸다
    document.addEventListener('visibilitychange', () => {
      if (isVisible()) void sendOnce();
    });
  }
}

/** 시험용: 상태와 타이머를 처음으로 */
export function resetFriendsForTest(): void {
  if (sendTimer) clearInterval(sendTimer);
  if (pollTimer) clearInterval(pollTimer);
  sendTimer = null;
  pollTimer = null;
  stopGps?.();
  stopGps = null;
  watchers = 0;
  myFix = null;
  sending = false;
  state = { available: getAuth() !== null, code: null, friends: [], loaded: false, busy: false, error: null, notice: null, sharing: false, lastSentAt: null, positions: [] };
}
