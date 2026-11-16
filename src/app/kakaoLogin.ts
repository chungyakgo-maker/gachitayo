// 카카오 로그인 (설계 docs/superpowers/specs/2026-11-13-kakao-login-design.md 5.2·5.6):
// 시작할 때 이 창만 아는 verifier를 만들어 해시만 서버에 보내고, 카카오를 거쳐 돌아오면 verifier + 6자리 번호로 마친다.
// 돌아온 창이 시작한 창과 다르면(아이폰 홈 화면 앱 등) 그 창은 번호만 보여 주고, 사용자가 원래 앱에 번호를 넣어 마친다.
import { useSyncExternalStore } from 'react';
import { ApiError, apiFetch } from '../server/api';
import { accountEnabled } from '../server/config';
import { adoptLogin, friendlyServerError, getAuth, whileFinishingLogin } from './account';

const PENDING_KEY = 'gachitayo.kakaoLogin';
/** 진행 중 로그인의 유효 시간 (서버 state와 같게) */
export const KAKAO_PENDING_TTL_MS = 10 * 60_000;

interface StoredPending {
  state: string;
  verifier: string;
  /** 마친 뒤 돌아갈 화면 */
  from: string;
  startedAt: number;
}
export type KakaoPending = Omit<StoredPending, 'verifier'>;

/** 페이지 이동 (테스트에서 바꿔 끼운다) */
export const kakaoNav = { go: (url: string) => window.location.assign(url) };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
// 다른 탭에서 로그인을 마치거나 취소하면 이 탭의 "진행 중" 표시도 따라간다
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === PENDING_KEY) notify();
  });
}

function readStored(): StoredPending | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as StoredPending;
    return typeof p.state === 'string' && typeof p.verifier === 'string' && typeof p.startedAt === 'number' ? p : null;
  } catch {
    return null;
  }
}
function writeStored(p: StoredPending | null): void {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // 저장할 수 없으면 이 창에서는 마칠 수 없다
  }
  notify();
}

function livePending(): StoredPending | null {
  const p = readStored();
  if (p && Date.now() - p.startedAt > KAKAO_PENDING_TTL_MS) {
    writeStored(null);
    return null;
  }
  return p;
}

/** 진행 중인 카카오 로그인 (10분 지나면 없음) */
export function pendingKakaoLogin(): KakaoPending | null {
  const p = livePending();
  return p ? { state: p.state, from: p.from, startedAt: p.startedAt } : null;
}

let snapshot: KakaoPending | null = null;
let snapshotKey = '';
function getSnapshot(): KakaoPending | null {
  const p = pendingKakaoLogin();
  const key = p ? `${p.state}:${p.startedAt}` : '';
  if (key !== snapshotKey) {
    snapshotKey = key;
    snapshot = p;
  }
  return snapshot;
}
export function useKakaoPending(): KakaoPending | null {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getSnapshot);
}

export function cancelKakaoLogin(): void {
  writeStored(null);
}

let providers: Promise<{ kakao: boolean }> | null = null;
/** 서버가 카카오 로그인을 켜 두었는지 (한 번 받아 기억, 실패면 false이고 다음에 다시 묻는다) */
export function getProviders(): Promise<{ kakao: boolean }> {
  if (!accountEnabled()) return Promise.resolve({ kakao: false });
  providers ??= apiFetch<{ kakao?: boolean }>('GET', '/auth/providers')
    .then((r) => ({ kakao: r.kakao === true }))
    .catch(() => {
      providers = null;
      return { kakao: false };
    });
  return providers;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 카카오 로그인 시작: 서버에서 카카오 주소를 받아 이동한다. from: 마친 뒤 돌아갈 화면 */
export async function startKakaoLogin(from: string): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const returnTo = `${window.location.origin}${window.location.pathname}`;
  const r = await apiFetch<{ url: string }>('POST', '/auth/kakao/start', { token: getAuth()?.token, body: { returnTo, verifierHash: await sha256Hex(verifier) } });
  const state = new URL(r.url).searchParams.get('state') ?? '';
  writeStored({ state, verifier, from, startedAt: Date.now() });
  kakaoNav.go(r.url);
}

let afterLogin: () => void = () => {};
/** 로그인을 마친 뒤 할 일 (되살리기, main.tsx에서 정한다) */
export function setAfterKakaoLogin(fn: () => void): void {
  afterLogin = fn;
}

export type FinishResult = { ok: true; kind: string } | { ok: false; error: string };
let inflight: { state: string; p: Promise<FinishResult> } | null = null;
/** 이번 실행에서 마친 로그인 (화면이 늦게 떠도 같은 결과를 준다) */
let finished: { state: string; from: string; result: FinishResult } | null = null;

/** 이번 실행에서 이미 마친 로그인이면 돌아갈 화면 */
export function finishedKakaoLogin(state: string): { from: string } | null {
  return finished?.state === state ? { from: finished.from } : null;
}

/** 마치기: 이 창의 verifier와 번호로 서버에서 열쇠를 받는다. 같은 state로 겹쳐 부르면 한 번만 */
export function finishKakaoLogin(state: string, pin: string): Promise<FinishResult> {
  if (inflight?.state === state) return inflight.p;
  if (finished?.state === state) return Promise.resolve(finished.result);
  const p = (async (): Promise<FinishResult> => {
    const pending = livePending();
    if (!pending || pending.state !== state) return { ok: false, error: '이 창에서 시작한 로그인이 아니에요. 로그인을 시작한 앱에 번호를 넣어 주세요' };
    try {
      const r = await whileFinishingLogin(() =>
        apiFetch<{ userId: string; token: string; nickname: string; kind: string }>('POST', '/auth/kakao/finish', {
          token: getAuth()?.token,
          body: { state, verifier: pending.verifier, pin },
        }),
      );
      adoptLogin({ userId: r.userId, token: r.token, nickname: r.nickname, kakao: true });
      writeStored(null);
      const result: FinishResult = { ok: true, kind: r.kind };
      finished = { state, from: pending.from, result };
      afterLogin();
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) return { ok: false, error: '번호가 맞지 않아요' };
      if (e instanceof ApiError && e.status === 410) {
        writeStored(null);
        return { ok: false, error: '로그인 시간이 지났어요. 다시 시도해 주세요' };
      }
      return { ok: false, error: friendlyServerError(e) };
    }
  })().finally(() => {
    if (inflight?.p === p) inflight = null;
  });
  inflight = { state, p };
  return p;
}

/** 앱 시작 때: 카카오에서 이 창으로 돌아왔으면(#/auth/kakao?state&pin, 같은 창) 계정 확인보다 먼저 마친다 */
export async function finishFromHash(hash: string): Promise<void> {
  if (!hash.startsWith('#/auth/kakao')) return;
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  const state = q.get('state');
  const pin = q.get('pin');
  if (!state || !pin || livePending()?.state !== state) return;
  await finishKakaoLogin(state, pin);
}
