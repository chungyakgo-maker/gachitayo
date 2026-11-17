// 애플 로그인 (앱 로그인 설계 docs/superpowers/specs/2026-11-17-app-login-design.md, 아이폰 앱만):
//   POST /auth/apple {identityToken, authorizationCode, nonce, nickname?} (+선택 폰 열쇠) → {userId, token, nickname, kind}
// identityToken은 애플 공개 키로 서명을 확인하고(iss·aud·만료·nonce), 계정 규칙은 카카오와 같다(login.ts).
// 애플 비밀값(APPLE_SIGNIN_KEY_P8·APPLE_SIGNIN_KEY_ID·APPLE_TEAM_ID)이 있으면 authorizationCode를 refresh token으로 바꿔 두고,
// 계정을 지울 때 그 토큰으로 애플 연결을 끊는다(애플 규칙). 비밀값이 없으면 로그인은 되고 끊기만 못 한다.
import { bearer, sha256Hex, userOfToken } from './auth';
import { HttpError } from './http';
import { signInWithIdentity, type LoginKind } from './login';

export const APPLE_ISS = 'https://appleid.apple.com';
const KEYS_URL = 'https://appleid.apple.com/auth/keys';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
/** 애플 공개 키를 기억하는 시간 */
const KEYS_TTL_MS = 3_600_000;
/** 모르는 키 번호로 다시 받기는 이 간격에 한 번까지 (검토 지적: 아무 kid로 보내 애플 서버를 계속 부르게 하지 못하게) */
const KEYS_REFRESH_MIN_MS = 60_000;
/** 같은 애플 로그인을 다시 쓰지 못하게 기억하는 시간 (identityToken은 10분이면 만료) */
const REPLAY_KEEP_MS = 3_600_000;

const bundleId = (env: Cloudflare.Env) => env.APPLE_BUNDLE_ID || 'com.dgo.app';

function b64urlToBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

type AppleJwk = JsonWebKey & { kid?: string };
let keyCache: { at: number; keys: AppleJwk[] } | null = null;
/** 테스트에서만: 기억한 공개 키를 비운다 */
export function resetAppleKeysForTest(): void {
  keyCache = null;
}
async function appleKeys(now: number, fresh = false): Promise<AppleJwk[]> {
  if (keyCache && now - keyCache.at < (fresh ? KEYS_REFRESH_MIN_MS : KEYS_TTL_MS)) return keyCache.keys;
  const r = await fetch(KEYS_URL);
  if (!r.ok) throw new HttpError(502, '애플 서버에 연결하지 못했어요');
  const keys = ((await r.json()) as { keys?: AppleJwk[] }).keys ?? [];
  keyCache = { at: now, keys };
  return keys;
}

export interface AppleClaims {
  sub: string;
  email?: string;
}

/** 애플 identityToken 확인. 틀리면 401 */
export async function verifyAppleToken(env: Cloudflare.Env, idToken: string, nonce: string, now = Date.now()): Promise<AppleClaims> {
  const bad = () => new HttpError(401, '애플 로그인을 확인하지 못했어요');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw bad();
  let header: { alg?: string; kid?: string };
  let payload: { iss?: string; aud?: string | string[]; exp?: number; sub?: string; nonce?: string; email?: string };
  let signature: Uint8Array;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]!)));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]!)));
    signature = b64urlToBytes(parts[2]!);
  } catch {
    throw bad();
  }
  if (header.alg !== 'RS256' || !header.kid) throw bad();
  let jwk = (await appleKeys(now)).find((k) => k.kid === header.kid);
  // 애플이 키를 바꿨으면 한 번 다시 받는다
  if (!jwk) jwk = (await appleKeys(now, true)).find((k) => k.kid === header.kid);
  if (!jwk) throw bad();
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw bad();
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== APPLE_ISS || !aud.includes(bundleId(env)) || typeof payload.exp !== 'number' || payload.exp * 1000 < now) throw bad();
  if (typeof payload.sub !== 'string' || !payload.sub) throw bad();
  // nonce: 앱이 애플에 해시를 주고 서버에는 원래 값을 보낸다 (다른 곳에서 가로챈 토큰을 못 쓰게)
  if (payload.nonce !== (await sha256Hex(nonce))) throw bad();
  return { sub: payload.sub, email: payload.email };
}

export const appleRevokeConfigured = (env: Cloudflare.Env): boolean => Boolean(env.APPLE_SIGNIN_KEY_P8 && env.APPLE_SIGNIN_KEY_ID && env.APPLE_TEAM_ID);

/** 애플에 보내는 client_secret (ES256, 5분) */
async function clientSecret(env: Cloudflare.Env, now: number): Promise<string> {
  const pem = (env.APPLE_SIGNIN_KEY_P8 ?? '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', b64urlToBytes(pem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000);
  const head = b64urlJson({ alg: 'ES256', kid: (env.APPLE_SIGNIN_KEY_ID ?? '').trim() });
  const body = b64urlJson({ iss: (env.APPLE_TEAM_ID ?? '').trim(), iat, exp: iat + 300, aud: APPLE_ISS, sub: bundleId(env) });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

/** authorizationCode → refresh token (비밀값이 없거나 실패하면 null: 로그인은 막지 않는다).
 *  애플이 함께 준 id_token의 사용자 번호가 이 로그인과 같을 때만 쓴다 (검토 지적: 다른 사람의 code를 섞어 보내는 것 막기) */
export async function exchangeAppleCode(env: Cloudflare.Env, code: string, sub: string, now = Date.now()): Promise<string | null> {
  if (!appleRevokeConfigured(env) || !code) return null;
  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: bundleId(env), client_secret: await clientSecret(env, now), code, grant_type: 'authorization_code' }).toString(),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { refresh_token?: unknown; id_token?: unknown };
    // 애플 서버에서 바로 받은 id_token이라 서명은 따로 확인하지 않고 사용자 번호만 맞춘다
    let tokenSub: unknown = null;
    try {
      tokenSub = typeof j.id_token === 'string' ? (JSON.parse(new TextDecoder().decode(b64urlToBytes(j.id_token.split('.')[1] ?? ''))) as { sub?: unknown }).sub : null;
    } catch {
      tokenSub = null;
    }
    if (tokenSub !== sub) return null;
    return typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : null;
  } catch {
    return null;
  }
}

/** 애플 연결 끊기 (계정 삭제 때). 실패해도 던지지 않는다 */
export async function revokeApple(env: Cloudflare.Env, refreshToken: string, now = Date.now()): Promise<boolean> {
  if (!appleRevokeConfigured(env)) return false;
  try {
    const r = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: bundleId(env), client_secret: await clientSecret(env, now), token: refreshToken, token_type_hint: 'refresh_token' }).toString(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** 애플이 처음 로그인 때만 주는 이름: 20자까지, 비면 "드라이버" */
export function appleNickname(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return [...s].slice(0, 20).join('').trim() || '드라이버';
}

export async function finishApple(req: Request, env: Cloudflare.Env, body: unknown, ip: string, now = Date.now()): Promise<{ userId: string; token: string; nickname: string; kind: LoginKind }> {
  const b = (body ?? {}) as { identityToken?: unknown; authorizationCode?: unknown; nonce?: unknown; nickname?: unknown };
  if (typeof b.identityToken !== 'string' || b.identityToken.length > 8000) throw new HttpError(400, '잘못된 identityToken');
  if (typeof b.nonce !== 'string' || b.nonce.length < 16 || b.nonce.length > 200) throw new HttpError(400, '잘못된 nonce');
  const code = typeof b.authorizationCode === 'string' && b.authorizationCode.length <= 1000 ? b.authorizationCode : '';
  const token = bearer(req);
  const caller = token ? await userOfToken(env, token) : null;
  if (token && !caller) throw new HttpError(401, '로그인 필요');
  const claims = await verifyAppleToken(env, b.identityToken, b.nonce, now);
  // 같은 애플 로그인(identityToken)은 한 번만 (검토 지적: 가로챈 요청을 다시 보내는 것 막기)
  const tokenHash = await sha256Hex(b.identityToken);
  await env.DB.prepare('DELETE FROM apple_seen WHERE at < ?').bind(now - REPLAY_KEEP_MS).run();
  const fresh = await env.DB.prepare('INSERT OR IGNORE INTO apple_seen (token_hash, at) VALUES (?, ?)').bind(tokenHash, now).run();
  if (!fresh.meta.changes) throw new HttpError(401, '애플 로그인을 확인하지 못했어요');
  const refresh = await exchangeAppleCode(env, code, claims.sub, now);
  return signInWithIdentity(
    env,
    {
      provider: 'apple',
      subject: claims.sub,
      nickname: appleNickname(b.nickname),
      startUserId: caller,
      token: caller ? token : null,
      extra: (userId) =>
        refresh
          ? [env.DB.prepare('INSERT OR REPLACE INTO apple_tokens (user_id, subject, refresh_token, created_at) VALUES (?, ?, ?, ?)').bind(userId, claims.sub, refresh, now)]
          : [],
    },
    ip,
    now,
  );
}
