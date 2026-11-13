// 카카오 로그인 (설계 docs/superpowers/specs/2026-11-13-kakao-login-design.md 5.2~5.4)
//   POST /auth/kakao/start {returnTo, verifierHash}   (+선택 폰 열쇠) → {url} 카카오 인가 주소
//   GET  /auth/kakao/callback?code&state              카카오가 브라우저를 보냄 → returnTo#/auth/kakao?state&pin
//   POST /auth/kakao/finish {state, verifier, pin}    (+시작 때 계정이 있었으면 그 열쇠) → {userId, token, nickname, kind}
// 계정은 마치기에서만 바꾼다(verifier·번호·열쇠 확인 뒤). 콜백은 카카오 회원번호·닉네임과 번호만 적는다.
// 남이 보낸 링크로 피해자가 카카오를 거쳐도, 시작한 사람(verifier)과 피해자 화면의 번호가 둘 다 있어야 마칠 수 있다.
import { bearer, checkSignupLimit, newToken, newUserStatements, revokeTokenStatements, sha256Hex, userOfToken } from './auth';
import { HttpError } from './http';

/** 로그인 한 번의 유효 시간 */
export const STATE_TTL_MS = 10 * 60_000;
/** 같은 IP에서 1시간에 시작할 수 있는 로그인 수 */
export const START_LIMIT_PER_HOUR = 30;
/** 번호(pin)·verifier를 틀릴 수 있는 횟수 (이 횟수째에 그 로그인은 끝) */
export const PIN_TRIES = 5;

export type LoginKind = 'created' | 'linked' | 'login' | 'merged' | 'switched';

export const kakaoEnabled = (env: Cloudflare.Env): boolean => Boolean(env.KAKAO_REST_API_KEY && env.KAKAO_CLIENT_SECRET);
const redirectUriOf = (req: Request) => `${new URL(req.url).origin}/auth/kakao/callback`;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function kakaoAuthorizeUrl(env: Cloudflare.Env, redirectUri: string, state: string): string {
  const u = new URL('https://kauth.kakao.com/oauth/authorize');
  u.searchParams.set('client_id', env.KAKAO_REST_API_KEY ?? '');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  return u.href;
}

/** 카카오 닉네임: 앞뒤 공백을 빼고 20자(코드포인트)까지, 비면 "드라이버" */
export function kakaoNickname(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return [...s].slice(0, 20).join('').trim() || '드라이버';
}

/** 인가 코드로 카카오 회원번호·닉네임을 받는다. 카카오 토큰은 저장하지 않는다 */
export async function fetchKakaoUser(env: Cloudflare.Env, code: string, redirectUri: string): Promise<{ id: string; nickname: string }> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.KAKAO_REST_API_KEY ?? '',
    redirect_uri: redirectUri,
    code,
    client_secret: env.KAKAO_CLIENT_SECRET ?? '',
  });
  const t = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: form.toString(),
  });
  if (!t.ok) throw new Error(`카카오 토큰 교환 실패 ${t.status}`);
  const access = ((await t.json()) as { access_token?: unknown }).access_token;
  if (typeof access !== 'string' || !access) throw new Error('카카오 토큰 없음');
  const u = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${access}` } });
  if (!u.ok) throw new Error(`카카오 회원 정보 실패 ${u.status}`);
  const me = (await u.json()) as { id?: unknown; kakao_account?: { profile?: { nickname?: unknown } }; properties?: { nickname?: unknown } };
  if (typeof me.id !== 'number' && typeof me.id !== 'string') throw new Error('카카오 회원번호 없음');
  return { id: String(me.id), nickname: kakaoNickname(me.kakao_account?.profile?.nickname ?? me.properties?.nickname) };
}

// ── 시작 ──────────────────────────────────────────────

export async function startKakao(req: Request, env: Cloudflare.Env, body: unknown, ip: string, now = Date.now()): Promise<{ url: string }> {
  if (!kakaoEnabled(env)) throw new HttpError(503, '카카오 로그인 준비 중');
  const b = (body ?? {}) as { returnTo?: unknown; verifierHash?: unknown };
  if (typeof b.verifierHash !== 'string' || !/^[0-9a-f]{64}$/.test(b.verifierHash)) throw new HttpError(400, '잘못된 verifierHash');
  if (typeof b.returnTo !== 'string') throw new HttpError(400, '잘못된 returnTo');
  let back: URL;
  try {
    back = new URL(b.returnTo);
  } catch {
    throw new HttpError(400, '잘못된 returnTo');
  }
  // 열린 리다이렉트 금지: 웹앱 출처만
  if (back.origin !== env.ALLOWED_ORIGIN) throw new HttpError(400, '허용하지 않은 returnTo');
  back.hash = '';
  // 열쇠를 보냈으면 그 계정에서 시작한 로그인 (연결·합치기 대상)
  const token = bearer(req);
  const userId = token ? await userOfToken(env, token) : null;
  if (token && !userId) throw new HttpError(401, '로그인 필요');

  const hourAgo = now - 3_600_000;
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_states WHERE ip = ? AND created_at > ?').bind(ip, hourAgo).first<{ n: number }>();
  if ((recent?.n ?? 0) >= START_LIMIT_PER_HOUR) throw new HttpError(429, '잠시 뒤 다시 시도해 주세요');

  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.batch([
    // 시작 횟수를 세려고 1시간 동안 남긴다 (유효 시간은 10분)
    env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(hourAgo),
    env.DB.prepare('INSERT INTO oauth_states (state, verifier_hash, user_id, return_to, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(state, b.verifierHash, userId, back.href, ip, now),
  ]);
  return { url: kakaoAuthorizeUrl(env, redirectUriOf(req), state) };
}

// ── 콜백 ──────────────────────────────────────────────

interface StateRow {
  state: string;
  verifier_hash: string;
  user_id: string | null;
  return_to: string;
  ip: string;
  created_at: number;
  kakao_id: string | null;
  kakao_nickname: string | null;
  pin_hash: string | null;
  tries: number;
}

function expiredPage(): Response {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>로그인</title></head>
<body style="font-family:sans-serif;background:#111;color:#eee;padding:32px;line-height:1.6"><p>로그인 시간이 지났어요. 앱에서 다시 시도해 주세요.</p></body></html>`;
  return new Response(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const back = (row: StateRow, q: Record<string, string>) =>
  new Response(null, { status: 302, headers: { Location: `${row.return_to}#/auth/kakao?${new URLSearchParams({ state: row.state, ...q }).toString()}`, 'Cache-Control': 'no-store' } });

const pinHash = (state: string, pin: string) => sha256Hex(`${state}:${pin}`);

export async function kakaoCallback(req: Request, env: Cloudflare.Env, now = Date.now()): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const state = q.get('state') ?? '';
  const row = state ? await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?').bind(state).first<StateRow>() : null;
  if (!row || now - row.created_at > STATE_TTL_MS || row.pin_hash !== null) return expiredPage();
  if (q.get('error')) {
    await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
    return back(row, { error: q.get('error') === 'access_denied' ? 'cancelled' : 'failed' });
  }
  const code = q.get('code');
  let user: { id: string; nickname: string };
  try {
    if (!code) throw new Error('인가 코드 없음');
    user = await fetchKakaoUser(env, code, redirectUriOf(req));
  } catch {
    await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
    return back(row, { error: 'failed' });
  }
  const pin = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');
  await env.DB.prepare('UPDATE oauth_states SET kakao_id = ?, kakao_nickname = ?, pin_hash = ? WHERE state = ?').bind(user.id, user.nickname, await pinHash(state, pin), state).run();
  return back(row, { pin });
}

// ── 마치기 ────────────────────────────────────────────

const identityOf = (env: Cloudflare.Env, kakaoId: string) =>
  env.DB.prepare("SELECT user_id FROM identities WHERE provider = 'kakao' AND subject = ?").bind(kakaoId).first<{ user_id: string }>();
const hasKakao = async (env: Cloudflare.Env, userId: string) =>
  (await env.DB.prepare("SELECT 1 AS x FROM identities WHERE user_id = ? AND provider = 'kakao'").bind(userId).first()) !== null;

/** 합치기 (5.4): 익명 B의 코스·기록·랩·친구를 A로 옮기고 B를 지운다 (batch 한 번 = 한 덩어리).
 *  파일은 R2에서 옮기지 않는다: 기록 행에 저장된 키(B 폴더)로 파일 게이트웨이가 찾아 준다 */
export function mergeUsers(env: Cloudflare.Env, from: string, into: string): D1PreparedStatement[] {
  const db = env.DB;
  return [
    db.prepare('UPDATE courses SET owner_id = ? WHERE owner_id = ?').bind(into, from),
    db.prepare('UPDATE sessions SET owner_id = ? WHERE owner_id = ?').bind(into, from),
    db.prepare('UPDATE laps SET owner_id = ? WHERE owner_id = ?').bind(into, from),
    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) SELECT ?, friend_id, created_at FROM friends WHERE user_id = ? AND friend_id != ?').bind(into, from, into),
    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) SELECT user_id, ?, created_at FROM friends WHERE friend_id = ? AND user_id != ?').bind(into, from, into),
    db.prepare('DELETE FROM friends WHERE user_id = ? OR friend_id = ?').bind(from, from),
    db.prepare('DELETE FROM presence WHERE user_id = ?').bind(from),
    db.prepare('DELETE FROM users WHERE id = ?').bind(from),
  ];
}

export async function finishKakao(req: Request, env: Cloudflare.Env, body: unknown, ip: string, now = Date.now()): Promise<{ userId: string; token: string; nickname: string; kind: LoginKind }> {
  const b = (body ?? {}) as { state?: unknown; verifier?: unknown; pin?: unknown };
  if (typeof b.state !== 'string' || b.state.length < 16 || b.state.length > 100) throw new HttpError(400, '잘못된 state');
  if (typeof b.verifier !== 'string' || b.verifier.length < 20 || b.verifier.length > 200) throw new HttpError(400, '잘못된 verifier');
  if (typeof b.pin !== 'string' || !/^\d{6}$/.test(b.pin)) throw new HttpError(400, '번호는 6자리 숫자');

  // 한 번만: 행을 먼저 차지한다 (두 창이 동시에 마쳐도 하나만)
  const row = await env.DB.prepare('DELETE FROM oauth_states WHERE state = ? RETURNING *').bind(b.state).first<StateRow>();
  if (!row || now - row.created_at > STATE_TTL_MS) throw new HttpError(410, '로그인 시간이 지났어요. 다시 시도해 주세요');
  const putBack = (tries: number) =>
    env.DB.prepare('INSERT INTO oauth_states (state, verifier_hash, user_id, return_to, ip, created_at, kakao_id, kakao_nickname, pin_hash, tries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(row.state, row.verifier_hash, row.user_id, row.return_to, row.ip, row.created_at, row.kakao_id, row.kakao_nickname, row.pin_hash, tries)
      .run();
  if (row.pin_hash === null || row.kakao_id === null) {
    await putBack(row.tries);
    throw new HttpError(409, '아직 카카오 로그인이 끝나지 않았어요');
  }
  const token = bearer(req);
  const caller = token ? await userOfToken(env, token) : null;
  const ok =
    (await sha256Hex(b.verifier)) === row.verifier_hash && (await pinHash(row.state, b.pin)) === row.pin_hash && (row.user_id === null || caller === row.user_id);
  if (!ok) {
    if (row.tries + 1 < PIN_TRIES) await putBack(row.tries + 1);
    throw new HttpError(403, '번호가 맞지 않아요');
  }

  // 5.3 규칙
  const kakaoId = row.kakao_id;
  const known = await identityOf(env, kakaoId);
  const startUser = row.user_id !== null && (await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(row.user_id).first()) !== null ? row.user_id : null;
  const startLinked = startUser !== null && (await hasKakao(env, startUser));
  const iso = new Date(now).toISOString();
  const stmts: D1PreparedStatement[] = [];
  let userId: string;
  let kind: LoginKind;
  if (!known) {
    if (startUser && !startLinked) {
      userId = startUser;
      kind = 'linked';
    } else {
      await checkSignupLimit(env, ip, now);
      userId = crypto.randomUUID();
      kind = 'created';
      stmts.push(...newUserStatements(env, userId, kakaoNickname(row.kakao_nickname), await sha256Hex(newToken()), ip, now));
    }
    stmts.push(env.DB.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('kakao', ?, ?, ?)").bind(kakaoId, userId, iso));
  } else {
    userId = known.user_id;
    if (!startUser || startUser === userId) kind = 'login';
    else if (!startLinked) {
      kind = 'merged';
      stmts.push(...mergeUsers(env, startUser, userId));
    } else kind = 'switched';
  }
  // 이 폰의 예전 열쇠는 못 쓰게 (새 열쇠로 바꾼다)
  if (token && caller) stmts.push(...(await revokeTokenStatements(env, token)));
  const fresh = newToken();
  stmts.push(env.DB.prepare('INSERT INTO user_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(fresh), userId, iso));
  await env.DB.batch(stmts);
  const nick = await env.DB.prepare('SELECT nickname FROM users WHERE id = ?').bind(userId).first<{ nickname: string }>();
  return { userId, token: fresh, nickname: nick!.nickname, kind };
}
