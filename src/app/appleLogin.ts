// 애플 로그인 (아이폰 앱만, 앱 로그인 설계 docs/superpowers/specs/2026-11-17-app-login-design.md):
// 임의 값(nonce)을 만들어 해시만 애플 창에 주고, 받은 identityToken·authorizationCode와 원래 값을 서버(POST /auth/apple)로.
// 지금 폰의 계정 열쇠를 같이 보내 익명 계정이면 그 계정에 연결한다 (카카오와 같은 규칙)
import { ApiError, apiFetch } from '../server/api';
import { adoptLogin, friendlyServerError, getAuth, whileFinishingLogin } from './account';
import { DgoAuth } from './nativeAuth';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let afterLogin: () => void = () => {};
/** 로그인을 마친 뒤 할 일 (되살리기, main.tsx에서 정한다) */
export function setAfterAppleLogin(fn: () => void): void {
  afterLogin = fn;
}

export type AppleResult = { ok: true; kind: string } | { ok: false; error: string } | { ok: false; cancelled: true };

export async function startAppleLogin(): Promise<AppleResult> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(32)));
  let res: Awaited<ReturnType<typeof DgoAuth.appleSignIn>>;
  try {
    res = await DgoAuth.appleSignIn({ nonce: await sha256Hex(nonce) });
  } catch (e) {
    return { ok: false, error: `애플 로그인을 열지 못했어요 (${e instanceof Error ? e.message : String(e)})` };
  }
  if (res.cancelled || !res.identityToken) return { ok: false, cancelled: true };
  try {
    const r = await whileFinishingLogin(() =>
      apiFetch<{ userId: string; token: string; nickname: string; kind: string }>('POST', '/auth/apple', {
        token: getAuth()?.token,
        body: { identityToken: res.identityToken, authorizationCode: res.authorizationCode ?? '', nonce, nickname: res.name || undefined },
      }),
    );
    adoptLogin({ userId: r.userId, token: r.token, nickname: r.nickname, apple: true });
    afterLogin();
    return { ok: true, kind: r.kind };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { ok: false, error: '애플 로그인을 확인하지 못했어요. 다시 시도해 주세요' };
    return { ok: false, error: friendlyServerError(e) };
  }
}
