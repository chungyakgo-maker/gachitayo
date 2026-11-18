// 팀·프로필 사진 앱 상태 (설계 docs/superpowers/specs/2026-11-18-team-drive-design.md)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ entered: [] as string[] }));
vi.mock('../../src/app/account', () => ({ getAuth: () => ({ userId: 'me', token: 'tok' }), friendlyServerError: () => '통신 오류' }));
vi.mock('../../src/app/group', () => ({ enterGroupRoom: async (id: string) => void h.entered.push(id) }));
vi.mock('../../src/server/config', () => ({ serverConfig: { apiUrl: 'https://api.test' } }));

const calls: Array<{ method: string; url: string; body: unknown; type: string | null }> = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const TEAM = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `팀 ${id}`,
  ownerId: 'me',
  members: [
    { userId: 'me', nickname: '세영', avatar: null },
    { userId: 'b', nickname: '민수', avatar: 'ab'.repeat(16) },
  ],
  gapS: 2,
  drive: null,
  ...over,
});
let server: Array<ReturnType<typeof TEAM>> = [];

beforeEach(() => {
  calls.length = 0;
  h.entered.length = 0;
  server = [TEAM('t1')];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, body, type: headers['Content-Type'] ?? null });
    const path = url.replace('https://api.test', '');
    if (path === '/api/teams' && method === 'GET') return json(200, { teams: server });
    if (path === '/api/teams' && method === 'POST' && (body as { name: string }).name === '여섯째') return json(409, { error: '팀은 5개까지예요' });
    if (path === '/api/teams' && method === 'POST') {
      const t = TEAM('t2', { name: (body as { name: string }).name });
      server.push(t);
      return json(200, t);
    }
    if (path === '/api/teams/t1/drive') return json(200, { roomId: 'room-1' });
    if (path === '/api/teams/t1/leave' || (path === '/api/teams/t1' && method === 'DELETE')) {
      server = server.filter((t) => t.id !== 't1');
      return json(200, { ok: true });
    }
    if (path === '/api/teams/t1' && method === 'PUT') return json(200, TEAM('t1', { name: (body as { name?: string }).name ?? '팀 t1' }));
    if (path === '/api/me/avatar' && method === 'PUT') return json(200, { avatar: 'cd'.repeat(16) });
    if (path === '/api/me/avatar' && method === 'DELETE') return json(200, { ok: true });
    if (path === '/api/me') return json(200, { userId: 'me', nickname: '세영', avatar: 'ef'.repeat(16) });
    return json(404, { error: '없음' });
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  const t = await import('../../src/app/teams');
  t.resetTeamsForTest();
});

describe('팀 상태', () => {
  it('목록을 받아 오고, 만들면 목록에 더한다', async () => {
    const t = await import('../../src/app/teams');
    expect(t.getTeams().loaded).toBe(false);
    await t.loadTeams();
    expect(t.getTeams()).toMatchObject({ loaded: true, teams: [{ id: 't1' }] });
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://api.test/api/teams' });
    const made = await t.createTeam('북악 새벽팀', ['b']);
    expect(made.name).toBe('북악 새벽팀');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: '북악 새벽팀', memberIds: ['b'] });
    expect(t.getTeams().teams.map((x) => x.id)).toEqual(['t1', 't2']);
  });

  it('팀 주행을 열면 서버가 준 방으로 들어간다', async () => {
    const t = await import('../../src/app/teams');
    await t.openTeamDrive('t1');
    expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', url: 'https://api.test/api/teams/t1/drive' }));
    expect(h.entered).toEqual(['room-1']);
  });

  it('나가기·지우기 뒤에는 목록에서 빠지고, 고치면 바뀐 팀으로', async () => {
    const t = await import('../../src/app/teams');
    await t.loadTeams();
    await t.updateTeam('t1', { name: '새 이름' });
    expect(t.getTeams().teams[0]!.name).toBe('새 이름');
    await t.leaveTeam('t1');
    expect(t.getTeams().teams).toEqual([]);
  });

  it('서버가 거절하면 서버가 준 말로 실패한다', async () => {
    const t = await import('../../src/app/teams');
    await expect(t.createTeam('여섯째', [])).rejects.toThrow('팀은 5개까지예요');
  });

  it('팀 수·인원 한도 (5개, 나 포함 15명)', async () => {
    const t = await import('../../src/app/teams');
    expect(t.TEAM_MAX).toBe(5);
    expect(t.TEAM_SIZE).toBe(15);
  });
});

describe('프로필 사진', () => {
  it('가운데 정사각형으로 자른다', async () => {
    const a = await import('../../src/app/avatar');
    expect(a.squareCrop(400, 300)).toEqual({ sx: 50, sy: 0, size: 300 });
    expect(a.squareCrop(300, 500)).toEqual({ sx: 0, sy: 100, size: 300 });
    expect(a.AVATAR_PX).toBe(160);
  });

  it('사진 주소: 없으면 null, 있으면 서버 /avatar/{id}.jpg', async () => {
    const a = await import('../../src/app/avatar');
    expect(a.avatarUrl(null)).toBeNull();
    expect(a.avatarUrl('ab'.repeat(16))).toBe(`https://api.test/avatar/${'ab'.repeat(16)}.jpg`);
  });

  it('올리면 JPEG 그대로 PUT하고 내 사진이 바뀐다, 지우면 없음', async () => {
    const a = await import('../../src/app/avatar');
    await a.loadMyAvatar();
    expect(a.getMyAvatar()).toBe('ef'.repeat(16));
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    await a.uploadAvatarJpeg(blob);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put).toMatchObject({ url: 'https://api.test/api/me/avatar', type: 'image/jpeg' });
    expect(put.body).toBe(blob);
    expect(a.getMyAvatar()).toBe('cd'.repeat(16));
    await a.removeAvatar();
    expect(a.getMyAvatar()).toBeNull();
  });
});
