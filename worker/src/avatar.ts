// 프로필 사진 (설계 docs/superpowers/specs/2026-11-18-team-drive-design.md, 사용자 요청 "아주 작은 프사 동그랗게", "업로드 방식으로만"):
// 앱이 160×160 JPEG로 줄여 올린다. R2 avatars/{id}.jpg 에 두고, id는 맞힐 수 없는 무작위라 주소를 아는 사람(친구·같은 팀)만 볼 수 있다.
// 새로 올리면 새 id라 받는 쪽은 오래 저장해 둬도 된다(옛 사진은 지운다).
import { HttpError, readLimited } from './http';

/** 160×160 JPEG는 보통 10KB 안팎. 넉넉히 100KB까지 */
export const AVATAR_MAX_BYTES = 100 * 1024;
export const AVATAR_ID_RE = /^[0-9a-f]{32}$/;
const key = (id: string) => `avatars/${id}.jpg`;

async function current(env: Cloudflare.Env, userId: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT avatar FROM users WHERE id = ?').bind(userId).first<{ avatar: string | null }>();
  return r?.avatar ?? null;
}

export async function putAvatar(env: Cloudflare.Env, userId: string, req: Request): Promise<{ avatar: string }> {
  const bytes = await readLimited(req, AVATAR_MAX_BYTES);
  // JPEG 머리(FF D8 FF)만 받는다 (앱이 언제나 JPEG로 만든다. 다른 파일을 사진 주소로 퍼뜨리지 못하게)
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new HttpError(400, '사진(JPEG)만 올릴 수 있어요');
  const id = crypto.randomUUID().replace(/-/g, '');
  await env.SESSION_FILES.put(key(id), bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  const old = await current(env, userId);
  await env.DB.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(id, userId).run();
  if (old) await env.SESSION_FILES.delete(key(old));
  return { avatar: id };
}

export async function deleteAvatar(env: Cloudflare.Env, userId: string): Promise<{ ok: true }> {
  const old = await current(env, userId);
  await env.DB.prepare('UPDATE users SET avatar = NULL WHERE id = ?').bind(userId).run();
  if (old) await env.SESSION_FILES.delete(key(old));
  return { ok: true };
}

/** GET /avatar/{id}.jpg: 열쇠 없이 준다 (img 태그로 바로 보이게). 새로 올리면 주소가 바뀌어 오래 저장해도 된다 */
export async function getAvatar(env: Cloudflare.Env, id: string, headers: Headers): Promise<Response> {
  if (!AVATAR_ID_RE.test(id)) throw new HttpError(404, '없는 사진');
  const obj = await env.SESSION_FILES.get(key(id));
  if (!obj) throw new HttpError(404, '없는 사진');
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(obj.body, { status: 200, headers });
}
