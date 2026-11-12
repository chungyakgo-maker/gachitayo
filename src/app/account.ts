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
  busy: boolean;
  error: string | null;
}

const ONBOARDED_KEY = 'gachitayo.onboarded';
const NICKNAME_KEY = 'gachitayo.nickname';
const TOKEN_KEY = 'gachitayo.token';
const USER_KEY = 'gachitayo.userId';

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
  busy: false,
  error: null,
};
const listeners = new Set<() => void>();
function set(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getAccountState = (): AccountState => state;
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

/** 서버가 열쇠를 모른다고 하면(401) 계정이 끊긴 것으로 본다 (사양서 9장: 첫 화면에 경고) */
export function markAccountLost(): void {
  if (state.status !== 'ready') return;
  token = null;
  write(TOKEN_KEY, null);
  set({ status: 'none' });
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

/** 앱 시작 때 한 번. 폰에 있는 열쇠가 아직 유효한지 확인한다 (통신이 없으면 그대로 둔다) */
export function initAccount(): Promise<void> {
  initPromise ??= (async () => {
    if (state.status !== 'ready' || !token) return;
    try {
      const me = await apiFetch<{ userId: string; nickname: string }>('GET', '/api/me', { token });
      if (me.nickname && me.nickname !== state.nickname) {
        write(NICKNAME_KEY, me.nickname);
        set({ nickname: me.nickname });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) markAccountLost();
    }
  })();
  return initPromise;
}

async function signUp(nickname: string): Promise<void> {
  const r = await apiFetch<{ userId: string; token: string }>('POST', '/auth/signup', { body: { nickname } });
  token = r.token;
  write(TOKEN_KEY, r.token);
  write(USER_KEY, r.userId);
  set({ status: 'ready', userId: r.userId });
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
