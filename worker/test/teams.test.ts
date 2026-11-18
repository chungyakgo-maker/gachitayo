// 팀·팀 주행·프로필 사진 서버 테스트 (설계 docs/superpowers/specs/2026-11-18-team-drive-design.md): 실제 Workers 런타임, D1·R2는 메모리
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/index';

const ORIGIN = 'https://example.github.io';
let ipSeq = 0;
function call(method: string, path: string, init: { token?: string; body?: object; raw?: Uint8Array; type?: string } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, 'CF-Connecting-IP': `10.7.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}` };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body) headers['Content-Type'] = 'application/json';
  if (init.raw) headers['Content-Type'] = init.type ?? 'image/jpeg';
  return handle(new Request(`https://api.example.workers.dev${path}`, { method, headers, body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined) }), env);
}
async function user(nickname: string) {
  const r = await call('POST', '/auth/signup', { body: { nickname } });
  return (await r.json()) as { userId: string; token: string };
}
async function befriend(a: { token: string }, b: { token: string }) {
  const code = ((await (await call('GET', '/api/friends', { token: b.token })).json()) as { code: string }).code;
  expect((await call('POST', '/api/friends', { token: a.token, body: { code } })).status).toBe(200);
}
/** JPEG 머리(FF D8 FF)로 시작하는 작은 가짜 사진 */
const jpeg = (n = 600, fill = 7) => {
  const b = new Uint8Array(n).fill(fill);
  b.set([0xff, 0xd8, 0xff, 0xe0], 0);
  b.set([0xff, 0xd9], n - 2);
  return b;
};
const me = async (token: string) => (await (await call('GET', '/api/me', { token })).json()) as { avatar: string | null };
type FriendRow = { userId: string; nickname: string; avatar: string | null; full: boolean };
const friendsOf = async (token: string) => ((await (await call('GET', '/api/friends', { token })).json()) as { friends: FriendRow[] }).friends;

describe('프로필 사진', () => {
  it('올리면 내 정보·친구 목록에 사진 id가 생기고, 그 주소로 사진을 받는다', async () => {
    const a = await user('세영');
    const b = await user('민수');
    await befriend(a, b);
    expect((await me(a.token)).avatar).toBeNull();
    const r = await call('PUT', '/api/me/avatar', { token: a.token, raw: jpeg() });
    expect(r.status).toBe(200);
    const { avatar } = (await r.json()) as { avatar: string };
    expect(avatar).toMatch(/^[0-9a-f]{32}$/);
    expect((await me(a.token)).avatar).toBe(avatar);
    expect((await friendsOf(b.token)).find((f) => f.userId === a.userId)?.avatar).toBe(avatar);
    const img = await call('GET', `/avatar/${avatar}.jpg`);
    expect(img.status).toBe(200);
    expect(img.headers.get('Content-Type')).toBe('image/jpeg');
    expect(img.headers.get('Cache-Control')).toContain('immutable');
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(jpeg());
  });

  it('사진이 아니거나 비었으면 400, 100KB를 넘으면 413', async () => {
    const a = await user('세영');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    expect((await call('PUT', '/api/me/avatar', { token: a.token, raw: png, type: 'image/png' })).status).toBe(400);
    expect((await call('PUT', '/api/me/avatar', { token: a.token, raw: new Uint8Array(0) })).status).toBe(400);
    expect((await call('PUT', '/api/me/avatar', { token: a.token, raw: jpeg(100 * 1024 + 1) })).status).toBe(413);
    expect((await me(a.token)).avatar).toBeNull();
  });

  it('다시 올리면 새 주소(옛 주소는 404), 지우면 없음', async () => {
    const a = await user('세영');
    const first = ((await (await call('PUT', '/api/me/avatar', { token: a.token, raw: jpeg(600, 1) })).json()) as { avatar: string }).avatar;
    const second = ((await (await call('PUT', '/api/me/avatar', { token: a.token, raw: jpeg(600, 2) })).json()) as { avatar: string }).avatar;
    expect(second).not.toBe(first);
    expect((await call('GET', `/avatar/${first}.jpg`)).status).toBe(404);
    expect((await call('GET', `/avatar/${second}.jpg`)).status).toBe(200);
    expect((await call('DELETE', '/api/me/avatar', { token: a.token })).status).toBe(200);
    expect((await me(a.token)).avatar).toBeNull();
    expect((await call('GET', `/avatar/${second}.jpg`)).status).toBe(404);
  });

  it('탈퇴하면 사진도 지운다', async () => {
    const a = await user('세영');
    const { avatar } = (await (await call('PUT', '/api/me/avatar', { token: a.token, raw: jpeg() })).json()) as { avatar: string };
    expect((await call('DELETE', '/api/me', { token: a.token })).status).toBe(200);
    expect((await call('GET', `/avatar/${avatar}.jpg`)).status).toBe(404);
  });

  it('잘못된 사진 주소는 404', async () => {
    expect((await call('GET', '/avatar/../x.jpg')).status).toBe(404);
    expect((await call('GET', '/avatar/abc.jpg')).status).toBe(404);
  });
});

describe('친구 목록: 팀이 가득 찬 친구', () => {
  it('친구가 팀 5개에 속해 있으면 full', async () => {
    const a = await user('세영');
    const b = await user('준호');
    await befriend(a, b);
    expect((await friendsOf(a.token))[0]!.full).toBe(false);
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO teams (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').bind(id, `팀${i}`, b.userId, now),
        env.DB.prepare('INSERT INTO team_members (team_id, user_id, added_at) VALUES (?, ?, ?)').bind(id, b.userId, now),
      ]);
    }
    expect((await friendsOf(a.token))[0]!.full).toBe(true);
  });
});

// ── 팀 ────────────────────────────────────────────────

type Team = {
  id: string;
  name: string;
  ownerId: string;
  members: Array<{ userId: string; nickname: string; avatar: string | null }>;
  gapS: number;
  drive: { roomId: string; count: number } | null;
};
type Room = { roomId: string; teamId: string | null; teamName: string | null; max: number; gapS: number; members: Array<{ userId: string; order: number; host: boolean; color: number; avatar: string | null }> };
const teamsOf = async (token: string) => {
  const r = await call('GET', '/api/teams', { token });
  expect(r.status).toBe(200);
  return ((await r.json()) as { teams: Team[] }).teams;
};
const create = (token: string, name: string, memberIds: string[]) => call('POST', '/api/teams', { token, body: { name, memberIds } });
async function team(owner: { token: string }, name: string, members: Array<{ userId: string }>) {
  const r = await create(owner.token, name, members.map((m) => m.userId));
  expect(r.status).toBe(200);
  return (await r.json()) as Team;
}
/** 나와 친구인 사람 n명 */
async function friendsFor(owner: { token: string }, n: number, prefix = '친구') {
  const out: Array<{ userId: string; token: string }> = [];
  for (let i = 0; i < n; i++) {
    const f = await user(`${prefix}${i + 1}`);
    await befriend(owner, f);
    out.push(f);
  }
  return out;
}
const drive = async (token: string, teamId: string) => call('POST', `/api/teams/${teamId}/drive`, { token });
const roomOf = async (token: string, roomId: string) => (await (await call('GET', `/api/rooms/${roomId}`, { token })).json()) as Room;

describe('팀 만들기·목록', () => {
  it('친구를 넣어 만들면 바로 팀원, 팀장과 팀원 모두 목록에 보인다', async () => {
    const a = await user('세영');
    const [b] = await friendsFor(a, 1);
    await call('PUT', '/api/me/avatar', { token: b!.token, raw: jpeg() });
    const t = await team(a, ' 북악 새벽팀 ', [b!]);
    expect(t).toMatchObject({ name: '북악 새벽팀', ownerId: a.userId, gapS: 2, drive: null });
    expect(t.members.map((m) => m.userId)).toEqual([a.userId, b!.userId]);
    expect(t.members[1]!.avatar).toMatch(/^[0-9a-f]{32}$/);
    expect((await teamsOf(b!.token)).map((x) => x.id)).toEqual([t.id]);
  });

  it('친구가 아닌 사람·이름 없음·21자 이름은 400, 나 포함 15명까지', async () => {
    const a = await user('세영');
    const stranger = await user('모르는사람');
    expect((await create(a.token, '팀', [stranger.userId])).status).toBe(400);
    expect((await create(a.token, '  ', [])).status).toBe(400);
    expect((await create(a.token, '가'.repeat(21), [])).status).toBe(400);
    const fs = await friendsFor(a, 15);
    expect((await create(a.token, '큰 팀', fs.map((f) => f.userId))).status).toBe(400);
    const ok = await team(a, '큰 팀', fs.slice(0, 14));
    expect(ok.members.length).toBe(15);
  });

  it('내가 속한 팀은 5개까지 (409), 팀이 5개인 친구는 넣을 수 없다 (409)', async () => {
    const a = await user('세영');
    const [b] = await friendsFor(a, 1);
    for (let i = 0; i < 5; i++) await team(a, `팀${i}`, []);
    expect((await create(a.token, '여섯째', [])).status).toBe(409);
    const c = await user('지훈');
    await befriend(c, b!);
    // b가 a의 팀 다섯 개에 들어가 가득 참
    for (const t of await teamsOf(a.token)) expect((await call('PUT', `/api/teams/${t.id}`, { token: a.token, body: { memberIds: [b!.userId] } })).status).toBe(200);
    expect((await friendsOf(c.token)).find((f) => f.userId === b!.userId)?.full).toBe(true);
    const r = await create(c.token, '새 팀', [b!.userId]);
    expect(r.status).toBe(409);
  });
});

describe('팀 고치기·나가기·지우기', () => {
  it('팀장만 이름·팀원을 바꾼다 (팀원은 403). 친구를 끊어도 이미 팀원이면 남는다', async () => {
    const a = await user('세영');
    const [b, c] = await friendsFor(a, 2);
    const t = await team(a, '팀', [b!]);
    expect((await call('PUT', `/api/teams/${t.id}`, { token: b!.token, body: { name: '내 팀' } })).status).toBe(403);
    await call('DELETE', `/api/friends/${b!.userId}`, { token: a.token });
    const r = await call('PUT', `/api/teams/${t.id}`, { token: a.token, body: { name: '새 이름', memberIds: [b!.userId, c!.userId] } });
    expect(r.status).toBe(200);
    const u = (await r.json()) as Team;
    expect(u.name).toBe('새 이름');
    expect(u.members.map((m) => m.userId).sort()).toEqual([a.userId, b!.userId, c!.userId].sort());
    // 빼기
    const v = (await (await call('PUT', `/api/teams/${t.id}`, { token: a.token, body: { memberIds: [c!.userId] } })).json()) as Team;
    expect(v.members.map((m) => m.userId)).toEqual([a.userId, c!.userId]);
    expect(await teamsOf(b!.token)).toEqual([]);
  });

  it('팀원은 나갈 수 있고 팀장은 못 나간다(400). 팀장이 지우면 모두에게서 사라진다', async () => {
    const a = await user('세영');
    const [b, c] = await friendsFor(a, 2);
    const t = await team(a, '팀', [b!, c!]);
    expect((await call('POST', `/api/teams/${t.id}/leave`, { token: a.token })).status).toBe(400);
    expect((await call('POST', `/api/teams/${t.id}/leave`, { token: b!.token })).status).toBe(200);
    expect(await teamsOf(b!.token)).toEqual([]);
    expect((await call('DELETE', `/api/teams/${t.id}`, { token: c!.token })).status).toBe(403);
    expect((await call('DELETE', `/api/teams/${t.id}`, { token: a.token })).status).toBe(200);
    expect(await teamsOf(a.token)).toEqual([]);
    expect(await teamsOf(c!.token)).toEqual([]);
  });

  it('팀장이 탈퇴하면 팀이 지워지고, 팀원이 탈퇴하면 팀에서 빠진다', async () => {
    const a = await user('세영');
    const [b, c] = await friendsFor(a, 2);
    const t = await team(a, '팀', [b!, c!]);
    await team(b!, 'b의 팀', []);
    expect((await call('DELETE', '/api/me', { token: c!.token })).status).toBe(200);
    expect((await teamsOf(a.token))[0]!.members.map((m) => m.userId)).toEqual([a.userId, b!.userId]);
    expect((await call('DELETE', '/api/me', { token: a.token })).status).toBe(200);
    expect((await teamsOf(b!.token)).map((x) => x.name)).toEqual(['b의 팀']);
    expect((await call('GET', `/api/teams/${t.id}`, { token: b!.token })).status).toBe(404);
  });
});

describe('팀 주행', () => {
  it('팀원 누구나 열고, 연 사람이 방장. 다른 팀원은 같은 방으로, 팀이 아니면 403', async () => {
    const a = await user('세영');
    const [b, c] = await friendsFor(a, 2);
    const t = await team(a, '북악 새벽팀', [b!]);
    const r1 = await drive(b!.token, t.id);
    expect(r1.status).toBe(200);
    const { roomId } = (await r1.json()) as { roomId: string };
    const r2 = (await (await drive(a.token, t.id)).json()) as { roomId: string };
    expect(r2.roomId).toBe(roomId);
    expect((await drive(c!.token, t.id)).status).toBe(403);
    const room = await roomOf(a.token, roomId);
    expect(room).toMatchObject({ teamId: t.id, teamName: '북악 새벽팀', max: 15 });
    expect(room.members.find((m) => m.host)?.userId).toBe(b!.userId);
    expect((await teamsOf(a.token))[0]!.drive).toEqual({ roomId, count: 2 });
  });

  it('방장이 바꾼 순서·차 간격은 팀이 기억해 다음 주행에 그대로', async () => {
    const a = await user('세영');
    const [b] = await friendsFor(a, 1);
    const t = await team(a, '팀', [b!]);
    const { roomId } = (await (await drive(a.token, t.id)).json()) as { roomId: string };
    await drive(b!.token, t.id);
    expect((await call('POST', `/api/rooms/${roomId}/gap`, { token: a.token, body: { gapS: 3.5 } })).status).toBe(200);
    expect((await call('POST', `/api/rooms/${roomId}/order`, { token: a.token, body: { userIds: [b!.userId, a.userId] } })).status).toBe(200);
    await call('POST', `/api/rooms/${roomId}/leave`, { token: a.token });
    await call('POST', `/api/rooms/${roomId}/leave`, { token: b!.token });
    // 모두 나가면 주행이 닫힌다 → 다시 열면 새 방
    expect((await teamsOf(a.token))[0]!.drive).toBeNull();
    const next = (await (await drive(a.token, t.id)).json()) as { roomId: string };
    expect(next.roomId).not.toBe(roomId);
    await drive(b!.token, t.id);
    const room = await roomOf(a.token, next.roomId);
    expect(room.gapS).toBe(3.5);
    expect([...room.members].sort((x, y) => x.order - y.order).map((m) => m.userId)).toEqual([b!.userId, a.userId]);
    expect(room.members.find((m) => m.host)?.userId).toBe(a.userId);
  });

  it('15명 방: 색이 모두 0~7 안에서 정해지고, 팀에서 빠지면 다시 못 들어온다', async () => {
    const a = await user('세영');
    const fs = await friendsFor(a, 14);
    const t = await team(a, '큰 팀', fs);
    const { roomId } = (await (await drive(a.token, t.id)).json()) as { roomId: string };
    for (const f of fs) expect((await drive(f.token, t.id)).status).toBe(200);
    const room = await roomOf(a.token, roomId);
    expect(room.members.length).toBe(15);
    expect(room.members.every((m) => Number.isInteger(m.color) && m.color >= 0 && m.color < 8)).toBe(true);
    await call('PUT', `/api/teams/${t.id}`, { token: a.token, body: { memberIds: fs.slice(1).map((f) => f.userId) } });
    await call('POST', `/api/rooms/${roomId}/leave`, { token: fs[0]!.token });
    expect((await drive(fs[0]!.token, t.id)).status).toBe(403);
  });
});
