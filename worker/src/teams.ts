// 팀 (설계 docs/superpowers/specs/2026-11-18-team-drive-design.md, 사용자 요청 "팀 만들기 → 최대 인원 15명, 친구 등록한 인원들을 넣어",
// "팀이 여러 개면 선택 후 해당 팀으로 주행 (팀은 최대 5개)"):
// 만든 사람이 팀장(이름·팀원 넣기/빼기·지우기), 팀원은 나가기. 팀원은 친구에서만 넣고 묻지 않고 바로 들어간다.
// 팀 주행은 지금 그룹 방(GroupRoom)을 팀 방으로 쓴다: 팀원 누구나 열고, 연 사람이 방장, 이미 열려 있으면 거기로.
//   GET    /api/teams              내가 속한 팀 (팀원·사진·열린 주행)
//   POST   /api/teams {name, memberIds}
//   GET    /api/teams/{id}         팀 하나 (팀원만)
//   PUT    /api/teams/{id} {name?, memberIds?}  (팀장만, memberIds는 팀장 뺀 전체)
//   DELETE /api/teams/{id}         (팀장만)
//   POST   /api/teams/{id}/leave   (팀원만, 팀장은 지우기)
//   POST   /api/teams/{id}/drive   팀 주행 열기·들어가기 → {roomId}
import { TEAM_MAX } from './friends';
import { profileOf, room, unwrap, type RoomState } from './group';
import { HttpError, UUID_RE } from './http';

/** 한 팀 나 포함 인원 (사용자 요청 "최대 인원 15명") */
export const TEAM_SIZE = 15;
export const TEAM_NAME_MAX = 20;

export interface TeamView {
  id: string;
  name: string;
  ownerId: string;
  members: Array<{ userId: string; nickname: string; avatar: string | null }>;
  gapS: number;
  drive: { roomId: string; count: number } | null;
}
interface TeamRow {
  id: string;
  name: string;
  owner_id: string;
  gap_s: number;
  order_json: string | null;
  drive_room_id: string | null;
}

function validName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name || [...name].length > TEAM_NAME_MAX) throw new HttpError(400, `팀 이름은 1~${TEAM_NAME_MAX}자예요`);
  return name;
}

/** 사람 id 목록 (중복·나 빼고). 모양이 틀리면 400 */
function validIds(v: unknown, self: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && UUID_RE.test(x))) throw new HttpError(400, '잘못된 팀원');
  return [...new Set((v as string[]).map((x) => x.toLowerCase()))].filter((x) => x !== self);
}

async function teamRow(env: Cloudflare.Env, teamId: string): Promise<TeamRow> {
  if (!UUID_RE.test(teamId)) throw new HttpError(400, '잘못된 팀');
  const t = await env.DB.prepare('SELECT id, name, owner_id, gap_s, order_json, drive_room_id FROM teams WHERE id = ?').bind(teamId.toLowerCase()).first<TeamRow>();
  if (!t) throw new HttpError(404, '팀을 찾지 못했어요');
  return t;
}

const isMember = async (env: Cloudflare.Env, teamId: string, userId: string) =>
  !!(await env.DB.prepare('SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?').bind(teamId, userId).first());

/** 새로 넣는 사람: 내 친구여야 하고, 팀이 5개 미만이어야 한다 */
async function checkNewMembers(env: Cloudflare.Env, ownerId: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    const r = await env.DB.prepare(
      `SELECT u.nickname, EXISTS (SELECT 1 FROM friends f WHERE f.user_id = ? AND f.friend_id = u.id) AS friend,
              (SELECT COUNT(*) FROM team_members tm WHERE tm.user_id = u.id) AS teams
         FROM users u WHERE u.id = ?`,
    )
      .bind(ownerId, id)
      .first<{ nickname: string; friend: number; teams: number }>();
    if (!r || r.friend !== 1) throw new HttpError(400, '친구만 팀에 넣을 수 있어요');
    if (r.teams >= TEAM_MAX) throw new HttpError(409, `${r.nickname}님은 팀이 가득 찼어요 (${TEAM_MAX}개)`);
  }
}

async function view(env: Cloudflare.Env, t: TeamRow): Promise<TeamView> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.nickname, u.avatar FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ? ORDER BY (u.id = ?) DESC, tm.added_at, u.nickname`,
  )
    .bind(t.id, t.owner_id)
    .all<{ id: string; nickname: string; avatar: string | null }>();
  let drive: TeamView['drive'] = null;
  if (t.drive_room_id) {
    const s = await room(env, t.drive_room_id).summary();
    if (s.alive) drive = { roomId: t.drive_room_id, count: s.count };
    // 닫힌 주행은 잊는다 (24시간이 지났거나 모두 나감)
    else await env.DB.prepare('UPDATE teams SET drive_room_id = NULL WHERE id = ? AND drive_room_id = ?').bind(t.id, t.drive_room_id).run();
  }
  return { id: t.id, name: t.name, ownerId: t.owner_id, members: results.map((r) => ({ userId: r.id, nickname: r.nickname, avatar: r.avatar ?? null })), gapS: t.gap_s, drive };
}

export async function listTeams(env: Cloudflare.Env, userId: string): Promise<{ teams: TeamView[] }> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.owner_id, t.gap_s, t.order_json, t.drive_room_id FROM teams t JOIN team_members tm ON tm.team_id = t.id
      WHERE tm.user_id = ? ORDER BY t.created_at`,
  )
    .bind(userId)
    .all<TeamRow>();
  return { teams: await Promise.all(results.map((t) => view(env, t))) };
}

export async function getTeam(env: Cloudflare.Env, userId: string, teamId: string): Promise<TeamView> {
  const t = await teamRow(env, teamId);
  if (!(await isMember(env, t.id, userId))) throw new HttpError(403, '팀원만 볼 수 있어요');
  return view(env, t);
}

export async function createTeam(env: Cloudflare.Env, userId: string, body: unknown, now = Date.now()): Promise<TeamView> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = validName(b.name);
  const ids = validIds(b.memberIds ?? [], userId);
  if (ids.length + 1 > TEAM_SIZE) throw new HttpError(400, `팀은 나 포함 ${TEAM_SIZE}명까지예요`);
  const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM team_members WHERE user_id = ?').bind(userId).first<{ n: number }>();
  if ((mine?.n ?? 0) >= TEAM_MAX) throw new HttpError(409, `팀은 ${TEAM_MAX}개까지예요`);
  await checkNewMembers(env, userId, ids);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO teams (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').bind(id, name, userId, now),
    // 팀장이 맨 앞 (added_at이 가장 이르다)
    env.DB.prepare('INSERT INTO team_members (team_id, user_id, added_at) VALUES (?, ?, ?)').bind(id, userId, now),
    ...ids.map((m, i) => env.DB.prepare('INSERT INTO team_members (team_id, user_id, added_at) VALUES (?, ?, ?)').bind(id, m, now + 1 + i)),
  ]);
  return view(env, await teamRow(env, id));
}

export async function updateTeam(env: Cloudflare.Env, userId: string, teamId: string, body: unknown, now = Date.now()): Promise<TeamView> {
  const t = await teamRow(env, teamId);
  if (t.owner_id !== userId) throw new HttpError(403, '팀장만 바꿀 수 있어요');
  const b = (body ?? {}) as Record<string, unknown>;
  const stmts: D1PreparedStatement[] = [];
  if (b.name !== undefined) stmts.push(env.DB.prepare('UPDATE teams SET name = ? WHERE id = ?').bind(validName(b.name), t.id));
  if (b.memberIds !== undefined) {
    const ids = validIds(b.memberIds, userId);
    if (ids.length + 1 > TEAM_SIZE) throw new HttpError(400, `팀은 나 포함 ${TEAM_SIZE}명까지예요`);
    const { results } = await env.DB.prepare('SELECT user_id FROM team_members WHERE team_id = ? AND user_id != ?').bind(t.id, userId).all<{ user_id: string }>();
    const now0 = new Set(results.map((r) => r.user_id));
    // 이미 팀원인 사람은 친구를 끊었어도 남는다. 새로 넣는 사람만 친구·팀 수를 본다
    const added = ids.filter((id) => !now0.has(id));
    const removed = [...now0].filter((id) => !ids.includes(id));
    await checkNewMembers(env, userId, added);
    for (const id of removed) stmts.push(env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').bind(t.id, id));
    added.forEach((id, i) => stmts.push(env.DB.prepare('INSERT INTO team_members (team_id, user_id, added_at) VALUES (?, ?, ?)').bind(t.id, id, now + i)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return view(env, await teamRow(env, t.id));
}

export async function deleteTeam(env: Cloudflare.Env, userId: string, teamId: string): Promise<{ ok: true }> {
  const t = await teamRow(env, teamId);
  if (t.owner_id !== userId) throw new HttpError(403, '팀장만 지울 수 있어요');
  await env.DB.batch([env.DB.prepare('DELETE FROM team_members WHERE team_id = ?').bind(t.id), env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(t.id)]);
  return { ok: true };
}

export async function leaveTeam(env: Cloudflare.Env, userId: string, teamId: string): Promise<{ ok: true }> {
  const t = await teamRow(env, teamId);
  if (t.owner_id === userId) throw new HttpError(400, '팀장은 팀을 지워야 나갈 수 있어요');
  await env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').bind(t.id, userId).run();
  return { ok: true };
}

/** 팀 주행 열기·들어가기: 열린 주행이 살아 있으면 들어가고, 없으면 새로 연다(연 사람이 방장, 팀이 기억한 순서·간격) */
export async function teamDrive(env: Cloudflare.Env, userId: string, teamId: string, now = Date.now()): Promise<{ roomId: string }> {
  const t = await teamRow(env, teamId);
  if (!(await isMember(env, t.id, userId))) throw new HttpError(403, '팀원만 팀 주행에 들어올 수 있어요');
  const p = await profileOf(env, userId);
  if (t.drive_room_id && (await room(env, t.drive_room_id).summary()).alive) {
    unwrap<RoomState>(await room(env, t.drive_room_id).join(userId, p.nickname, p.avatar));
    return { roomId: t.drive_room_id };
  }
  const roomId = crypto.randomUUID();
  // 먼저 자리를 차지한다: 두 사람이 동시에 열면 한 방만 남고 늦은 사람은 그 방으로 들어간다
  const claim = await env.DB.prepare('UPDATE teams SET drive_room_id = ? WHERE id = ? AND drive_room_id IS ?').bind(roomId, t.id, t.drive_room_id).run();
  if (claim.meta.changes !== 1) {
    const again = await teamRow(env, t.id);
    if (again.drive_room_id) {
      unwrap<RoomState>(await room(env, again.drive_room_id).join(userId, p.nickname, p.avatar));
      return { roomId: again.drive_room_id };
    }
    throw new HttpError(409, '잠시 뒤 다시 해 주세요');
  }
  let pref: string[] = [];
  try {
    pref = t.order_json ? (JSON.parse(t.order_json) as string[]) : [];
  } catch {
    pref = [];
  }
  await room(env, roomId).init('', userId, p.nickname, now, p.avatar, { teamId: t.id, teamName: t.name, gapS: t.gap_s, pref });
  return { roomId };
}
