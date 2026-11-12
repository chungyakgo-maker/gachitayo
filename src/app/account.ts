// 익명 계정 (사양서 8.1, 9장, 12장): 첫 실행에 닉네임을 받고 Supabase 익명 계정을 만든다.
// 서버 설정값이 아직 없으면 계정 없이 폰에만 저장한다.
import { useSyncExternalStore } from 'react';
import { accountEnabled } from '../server/config';
import { getSupabase } from '../server/supabase';

export type AccountStatus = 'disabled' | 'loading' | 'none' | 'ready';

export interface AccountState {
  /** disabled: 서버 설정 전, none: 계정 없음(첫 실행 전이거나 끊김), ready: 로그인됨 */
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

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장할 수 없어도 이번 실행 동안은 쓴다
  }
}

let state: AccountState = {
  status: accountEnabled() ? 'loading' : 'disabled',
  userId: null,
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
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getAccountState);
}

/** 서버 오류를 사용자에게 보여줄 말로 */
export function friendlyServerError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/anonymous sign-ins are disabled/i.test(m)) return '서버 설정이 아직 끝나지 않았어요 (Supabase에서 익명 로그인을 켜 주세요)';
  if (e instanceof TypeError || /fetch|network|load failed/i.test(m)) {
    return '서버에 연결할 수 없어요. 통신 상태를 확인하거나 잠시 뒤 다시 시도해 주세요 (서버 점검 중일 수 있어요)';
  }
  if (/rate limit/i.test(m)) return '잠시 뒤 다시 시도해 주세요 (요청이 너무 많아요)';
  return `서버 오류: ${m}`;
}

let initPromise: Promise<void> | undefined;

/** 앱 시작 때 한 번. 폰에 있는 로그인 세션을 확인한다 */
export function initAccount(): Promise<void> {
  initPromise ??= (async () => {
    if (!accountEnabled()) return;
    try {
      const sb = await getSupabase();
      const { data } = await sb.auth.getSession();
      set({ status: data.session ? 'ready' : 'none', userId: data.session?.user.id ?? null });
      sb.auth.onAuthStateChange((_event, session) => {
        set({ status: session ? 'ready' : 'none', userId: session?.user.id ?? null });
      });
    } catch (e) {
      set({ status: 'none', error: friendlyServerError(e) });
    }
  })();
  return initPromise;
}

async function signInWithNickname(nickname: string): Promise<void> {
  const sb = await getSupabase();
  let { data } = await sb.auth.getSession();
  if (!data.session) {
    const r = await sb.auth.signInAnonymously();
    if (r.error) throw r.error;
    data = { session: r.data.session };
  }
  const user = data.session?.user;
  if (!user) throw new Error('계정을 만들지 못했습니다');
  const { error } = await sb.from('profiles').upsert({ id: user.id, nickname }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  set({ status: 'ready', userId: user.id });
}

export const validNickname = (n: string): boolean => {
  const t = n.trim();
  return t.length >= 1 && t.length <= 20;
};

/** 첫 실행 "시작하기": 닉네임으로 익명 계정을 만든다 (서버 설정 전이면 폰에만 저장) */
export async function finishOnboarding(nickname: string): Promise<boolean> {
  const nick = nickname.trim();
  if (!validNickname(nick)) {
    set({ error: '닉네임은 1~20자로 적어 주세요' });
    return false;
  }
  set({ busy: true, error: null });
  try {
    if (accountEnabled()) await signInWithNickname(nick);
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
    await signInWithNickname(state.nickname ?? '드라이버');
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
    if (state.status === 'ready' && state.userId) {
      const { error } = await (await getSupabase()).from('profiles').upsert({ id: state.userId, nickname: nick }, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
    write(NICKNAME_KEY, nick);
    set({ nickname: nick, busy: false });
    return true;
  } catch (e) {
    set({ busy: false, error: friendlyServerError(e) });
    return false;
  }
}
