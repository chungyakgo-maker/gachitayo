// 익명 계정 (사양서 8.1, 9장, 12장, M6 결정: Cloudflare만): 첫 실행에 닉네임을 받고 같이타요 API에서
// 이 폰 전용 열쇠를 받아 폰(localStorage)에 보관한다. 서버 주소가 아직 없으면 계정 없이 폰에만 저장한다.
import { useSyncExternalStore } from 'react';
import { ApiError, apiFetch } from '../server/api';
import { accountEnabled } from '../server/config';

export type AccountStatus = 'disabled' | 'none' | 'ready';

export interface AccountState {
  /** disabled: 서버 연결 전, none: 계정 없음(첫 실행 전이거나 끊김), ready: 계정 있음 */
  status: AccountStatus;
  userId: string | null;
  nickname: string | null;
  /** 첫 실행 안내를 마쳤는지 */
  onboarded: boolean;
  /** 있던 계정의 열쇠를 서버가 모른다고 함 (자동으로 새로 만들지 않고 사용자가 설정에서 고른다) */
  lost: boolean;
  /** 카카오에 연결된 계정 (설계 docs/superpowers/specs/2026-11-13-kakao-login-design.md) */
  kakao: boolean;
  busy: boolean;
  error: string | null;
}

const ONBOARDED_KEY = 'gachitayo.onboarded';
const NICKNAME_KEY = 'gachitayo.nickname';
const TOKEN_KEY = 'gachitayo.token';
const USER_KEY = 'gachitayo.userId';
const KAKAO_KEY = 'gachitayo.kakao';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 저장할 수 없어도 이번 실행 동안은 쓴다
  }
}

let token: string | null = read(TOKEN_KEY);

let state: AccountState = {
  status: !accountEnabled() ? 'disabled' : token && read(USER_KEY) ? 'ready' : 'none',
  userId: read(USER_KEY),
  nickname: read(NICKNAME_KEY),
  onboarded: read(ONBOARDED_KEY) === '1',
  // 열쇠는 지우고 사용자 ID만 남아 있으면 끊긴 계정
  lost: accountEnabled() && !token && read(USER_KEY) !== null,
  kakao: read(KAKAO_KEY) === '1',
  busy: false,
  error: null,
};
const listeners = new Set<() => void>();
function set(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getAccountState = (): AccountState => state;

/** 다른 탭(같은 저장소)에서 로그인·로그아웃하면 이 탭도 따라간다 (카카오 로그인이 다른 탭에서 끝난 경우) */
function syncFromStorage(): void {
  token = read(TOKEN_KEY);
  const userId = read(USER_KEY);
  set({
    status: !accountEnabled() ? 'disabled' : token && userId ? 'ready' : 'none',
    userId,
    nickname: read(NICKNAME_KEY),
    onboarded: read(ONBOARDED_KEY) === '1',
    kakao: read(KAKAO_KEY) === '1',
    lost: accountEnabled() && !token && userId !== null,
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === TOKEN_KEY) syncFromStorage();
  });
}
export function subscribeAccount(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function useAccount(): AccountState {
  return useSyncExternalStore(subscribeAccount, getAccountState);
}

/** 업로드에 쓰는 사용자 ID와 폰 열쇠. 계정이 없으면 null */
export function getAuth(): { userId: string; token: string } | null {
  return state.status === 'ready' && state.userId && token ? { userId: state.userId, token } : null;
}

/** 카카오 로그인을 마치는 중 (그 사이 받은 401은 예전 열쇠라서 계정 끊김으로 보지 않는다) */
let finishingLogin = 0;
export async function whileFinishingLogin<T>(fn: () => Promise<T>): Promise<T> {
  finishingLogin++;
  try {
    return await fn();
  } finally {
    finishingLogin--;
  }
}

/** 로그인으로 받은 계정을 이 폰의 계정으로 쓴다 (카카오 로그인 마치기) */
export function adoptLogin(r: { userId: string; token: string; nickname: string; kakao: boolean }): void {
  token = r.token;
  write(TOKEN_KEY, r.token);
  write(USER_KEY, r.userId);
  write(NICKNAME_KEY, r.nickname);
  write(ONBOARDED_KEY, '1');
  write(KAKAO_KEY, r.kakao ? '1' : null);
  set({ status: 'ready', userId: r.userId, nickname: r.nickname, onboarded: true, lost: false, kakao: r.kakao, busy: false, error: null });
}

/** 이 폰에서 계정을 잊는다 (로그아웃). 설정은 남긴다 */
export function forgetAccount(): void {
  token = null;
  for (const k of [TOKEN_KEY, USER_KEY, NICKNAME_KEY, ONBOARDED_KEY, KAKAO_KEY]) write(k, null);
  set({ status: accountEnabled() ? 'none' : 'disabled', userId: null, nickname: null, onboarded: false, lost: false, kakao: false, busy: false, error: null });
}

/** 서버에 이 폰 열쇠를 못 쓰게 한다 (로그아웃). 통신 실패는 그대로 던진다 */
export async function logoutRemote(): Promise<void> {
  if (state.status === 'ready' && token) await apiFetch('POST', '/auth/logout', { token });
}

/** 서버가 열쇠를 모른다고 하면(401) 계정이 끊긴 것으로 본다 (사양서 9장: 첫 화면에 경고).
 *  usedToken: 401을 받은 요청의 열쇠. 그사이 로그인으로 열쇠가 바뀌었으면(예전 열쇠의 401) 무시한다 */
export function markAccountLost(usedToken?: string | null): void {
  if (state.status !== 'ready' || finishingLogin > 0) return;
  if (usedToken != null && (usedToken !== token || read(TOKEN_KEY) !== usedToken)) return;
  token = null;
  write(TOKEN_KEY, null);
  set({ status: 'none', lost: true });
}

/** 서버 오류를 사용자에게 보여줄 말로 */
export function friendlyServerError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return '잠시 뒤 다시 시도해 주세요 (짧은 시간에 계정을 너무 많이 만들었어요)';
    if (e.status >= 500) return '서버에 문제가 있어요. 잠시 뒤 다시 시도해 주세요';
    return `서버 오류: ${e.message}`;
  }
  if (e instanceof TypeError) return '서버에 연결할 수 없어요. 통신 상태를 확인하고 다시 시도해 주세요';
  return `오류: ${e instanceof Error ? e.message : String(e)}`;
}

let initPromise: Promise<void> | undefined;

/** 앱 시작 때 한 번. 폰에 있는 열쇠가 아직 유효한지 확인한다 (통신이 없으면 그대로 둔다).
 *  서버 연결 전에 첫 실행을 마친 사람은 여기서 계정을 만든다 */
export function initAccount(): Promise<void> {
  initPromise ??= (async () => {
    if (state.status === 'none') return ensureAccount();
    if (state.status !== 'ready' || !token) return;
    try {
      const me = await apiFetch<{ userId: string; nickname: string; kakao?: boolean }>('GET', '/api/me', { token });
      if (me.nickname && me.nickname !== state.nickname) {
        write(NICKNAME_KEY, me.nickname);
        set({ nickname: me.nickname });
      }
      const kakao = me.kakao === true;
      if (kakao !== state.kakao) {
        write(KAKAO_KEY, kakao ? '1' : null);
        set({ kakao });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) markAccountLost(token);
    }
  })();
  return initPromise;
}

async function signUp(nickname: string): Promise<void> {
  const r = await apiFetch<{ userId: string; token: string }>('POST', '/auth/signup', { body: { nickname } });
  token = r.token;
  write(TOKEN_KEY, r.token);
  write(USER_KEY, r.userId);
  set({ status: 'ready', userId: r.userId, lost: false });
}

let ensuring: Promise<void> | null = null;

/** 첫 실행은 마쳤는데 계정이 없으면(서버 연결 전에 시작한 경우) 저장된 닉네임으로 조용히 만든다.
 *  통신이 없으면 그대로 두고 다음 기회(통신 복구·화면 복귀·1분마다)에 다시 한다. 끊긴 계정은 건드리지 않는다 */
export function ensureAccount(): Promise<void> {
  if (!accountEnabled() || state.status !== 'none' || !state.onboarded || state.lost || state.busy) return ensuring ?? Promise.resolve();
  ensuring ??= (async () => {
    try {
      await signUp(state.nickname ?? '드라이버');
    } catch {
      // 다음 기회에
    } finally {
      ensuring = null;
    }
  })();
  return ensuring;
}

export const validNickname = (n: string): boolean => {
  const t = n.trim();
  return t.length >= 1 && t.length <= 20;
};

/** 첫 실행 "시작하기": 닉네임으로 익명 계정을 만든다 (서버 연결 전이면 폰에만 저장) */
export async function finishOnboarding(nickname: string): Promise<boolean> {
  const nick = nickname.trim();
  if (!validNickname(nick)) {
    set({ error: '닉네임은 1~20자로 적어 주세요' });
    return false;
  }
  set({ busy: true, error: null });
  try {
    if (accountEnabled() && state.status !== 'ready') await signUp(nick);
    else if (state.status === 'ready' && token) await apiFetch('PUT', '/api/me', { token, body: { nickname: nick } });
    write(NICKNAME_KEY, nick);
    write(ONBOARDED_KEY, '1');
    set({ nickname: nick, onboarded: true, busy: false });
    return true;
  } catch (e) {
    set({ busy: false, error: friendlyServerError(e) });
    return false;
  }
}

/** 계정이 끊겼을 때(브라우저 데이터 삭제 등) 새 익명 계정을 만든다. 예전 서버 기록은 이 계정으로 볼 수 없다 */
export async function recreateAccount(): Promise<boolean> {
  if (!accountEnabled()) return false;
  set({ busy: true, error: null });
  try {
    await signUp(state.nickname ?? '드라이버');
    set({ busy: false });
    return true;
  } catch (e) {
    set({ busy: false, error: friendlyServerError(e) });
    return false;
  }
}

export async function updateNickname(nickname: string): Promise<boolean> {
  const nick = nickname.trim();
  if (!validNickname(nick)) {
    set({ error: '닉네임은 1~20자로 적어 주세요' });
    return false;
  }
  set({ busy: true, error: null });
  try {
    if (state.status === 'ready' && token) await apiFetch('PUT', '/api/me', { token, body: { nickname: nick } });
    write(NICKNAME_KEY, nick);
    set({ nickname: nick, busy: false });
    return true;
  } catch (e) {
    set({ busy: false, error: friendlyServerError(e) });
    return false;
  }
}
