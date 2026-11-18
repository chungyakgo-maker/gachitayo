// 다른 회사 로그인(카카오·애플) 공통 계정 규칙 (카카오 설계 5.3, 앱 로그인 설계 2026-11-17):
//   처음 보는 로그인 + 지금 익명 계정 → 그 계정에 연결(linked) / 계정 없음·이미 다른 로그인 → 새 계정(created)
//   아는 로그인 → 로그인(login), 지금 익명 계정이면 그 기록을 합침(merged), 다른 로그인 계정이면 바꿈(switched)
// 이 폰의 예전 열쇠는 못 쓰게 하고 새 열쇠를 준다.
import { checkSignupLimit, newToken, newUserStatements, revokeTokenStatements, sha256Hex } from './auth';

export type LoginKind = 'created' | 'linked' | 'login' | 'merged' | 'switched';
export type Provider = 'kakao' | 'apple';

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
    // 팀: B가 팀장인 팀은 A가 팀장, B가 속한 팀에는 A가 들어간다 (검토 지적: 합치면 팀이 사라졌다)
    db.prepare('UPDATE teams SET owner_id = ? WHERE owner_id = ?').bind(into, from),
    db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, added_at) SELECT team_id, ?, added_at FROM team_members WHERE user_id = ?').bind(into, from),
    db.prepare('DELETE FROM team_members WHERE user_id = ?').bind(from),
    // 프로필 사진: A에 없으면 B 사진을 쓴다 (A에 있으면 B 사진 파일은 합친 뒤 지운다, signInWithIdentity)
    db.prepare('UPDATE users SET avatar = (SELECT avatar FROM users WHERE id = ?) WHERE id = ? AND avatar IS NULL').bind(from, into),
    db.prepare('DELETE FROM users WHERE id = ?').bind(from),
  ];
}

/** 이 계정에 다른 회사 로그인(카카오·애플 어느 것이든)이 붙어 있는지: 붙어 있으면 "익명 계정"이 아니다 */
const hasLogin = async (env: Cloudflare.Env, userId: string) => (await env.DB.prepare('SELECT 1 AS x FROM identities WHERE user_id = ?').bind(userId).first()) !== null;

export async function signInWithIdentity(
  env: Cloudflare.Env,
  o: {
    provider: Provider;
    subject: string;
    /** 새 계정일 때 쓸 닉네임 */
    nickname: string;
    /** 이 로그인을 시작한 계정 (없으면 null) */
    startUserId: string | null;
    /** 지금 폰의 열쇠 (서버가 아는 열쇠일 때만 넘긴다. 새 열쇠로 바꾼다) */
    token: string | null;
    /** 계정이 정해진 뒤 같은 덩어리로 할 일 (애플 연결 끊기용 토큰 저장 등) */
    extra?: (userId: string) => D1PreparedStatement[];
  },
  ip: string,
  now = Date.now(),
): Promise<{ userId: string; token: string; nickname: string; kind: LoginKind }> {
  const known = await env.DB.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?').bind(o.provider, o.subject).first<{ user_id: string }>();
  const startUser = o.startUserId !== null && (await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(o.startUserId).first()) !== null ? o.startUserId : null;
  const startLinked = startUser !== null && (await hasLogin(env, startUser));
  const iso = new Date(now).toISOString();
  const stmts: D1PreparedStatement[] = [];
  let userId: string;
  let kind: LoginKind;
  let mergedAvatar: string | null = null;
  if (!known) {
    // 지금 계정에 같은 회사 로그인이 없으면 붙인다 (익명 계정, 또는 카카오 계정에 애플을 더 붙임).
    // 이미 같은 회사 로그인이 붙어 있으면(다른 카카오 계정 등) 새 계정
    const sameProvider = startUser !== null && (await env.DB.prepare('SELECT 1 AS x FROM identities WHERE user_id = ? AND provider = ?').bind(startUser, o.provider).first()) !== null;
    if (startUser && !sameProvider) {
      userId = startUser;
      kind = 'linked';
    } else {
      await checkSignupLimit(env, ip, now);
      userId = crypto.randomUUID();
      kind = 'created';
      stmts.push(...newUserStatements(env, userId, o.nickname, await sha256Hex(newToken()), ip, now));
    }
    stmts.push(env.DB.prepare('INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)').bind(o.provider, o.subject, userId, iso));
  } else {
    userId = known.user_id;
    if (!startUser || startUser === userId) kind = 'login';
    else if (!startLinked) {
      kind = 'merged';
      mergedAvatar = (await env.DB.prepare('SELECT avatar FROM users WHERE id = ?').bind(startUser).first<{ avatar: string | null }>())?.avatar ?? null;
      stmts.push(...mergeUsers(env, startUser, userId));
    } else kind = 'switched';
  }
  if (o.extra) stmts.push(...o.extra(userId));
  // 이 폰의 예전 열쇠는 못 쓰게 (새 열쇠로 바꾼다)
  if (o.token) stmts.push(...(await revokeTokenStatements(env, o.token)));
  const fresh = newToken();
  stmts.push(env.DB.prepare('INSERT INTO user_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(fresh), userId, iso));
  await env.DB.batch(stmts);
  // 합친 B의 사진을 A가 쓰지 않으면 파일을 지운다 (아무도 가리키지 않는 사진이 남지 않게)
  if (mergedAvatar) {
    const cur = await env.DB.prepare('SELECT avatar FROM users WHERE id = ?').bind(userId).first<{ avatar: string | null }>();
    if (cur?.avatar !== mergedAvatar) await env.SESSION_FILES.delete(`avatars/${mergedAvatar}.jpg`);
  }
  const nick = await env.DB.prepare('SELECT nickname FROM users WHERE id = ?').bind(userId).first<{ nickname: string }>();
  return { userId, token: fresh, nickname: nick!.nickname, kind };
}
