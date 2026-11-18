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
