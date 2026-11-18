// 프로필 사진 (설계 docs/superpowers/specs/2026-11-18-team-drive-design.md, 사용자 요청 "아주 작은 프사 동그랗게", "업로드 방식으로만"):
// 폰 사진 → 가운데 정사각형으로 잘라 160×160 JPEG → 서버에 올린다. 화면에는 동그랗게 26px (내 프로필 76px).
// 주소는 서버가 준 무작위 id로 만든다(새로 올리면 바뀜). 친구·같은 팀만 그 id를 받는다.
import { useSyncExternalStore } from 'react';
import { ApiError, apiFetch } from '../server/api';
import { serverConfig } from '../server/config';
import { getAuth } from './account';

export const AVATAR_PX = 160;

export const avatarUrl = (id: string | null | undefined): string | null => (id ? `${serverConfig.apiUrl}/avatar/${id}.jpg` : null);

/** 가운데 정사각형 (짧은 변 기준) */
export function squareCrop(w: number, h: number): { sx: number; sy: number; size: number } {
  const size = Math.min(w, h);
  return { sx: Math.round((w - size) / 2), sy: Math.round((h - size) / 2), size };
}

/** 사진 → 가운데 정사각형 size×size JPEG (사진 방향은 브라우저가 맞춰 읽는다) */
export async function squareJpeg(file: Blob, size = AVATAR_PX): Promise<Blob> {
  const img = await createImageBitmap(file);
  const c = squareCrop(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('사진을 줄이지 못했어요');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, c.sx, c.sy, c.size, c.size, 0, 0, size, size);
  img.close?.();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('사진을 줄이지 못했어요');
  return blob;
}

// 내 사진 id (undefined = 아직 안 받음)
let mine: string | null | undefined;
const listeners = new Set<() => void>();
function setMine(v: string | null): void {
  mine = v;
  listeners.forEach((l) => l());
}
export const getMyAvatar = (): string | null | undefined => mine;
export function useMyAvatar(): string | null | undefined {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getMyAvatar);
}

function token(): string {
  const auth = getAuth();
  if (!auth) throw new Error('계정이 있어야 사진을 올릴 수 있어요');
  return auth.token;
}

export async function loadMyAvatar(): Promise<void> {
  const me = await apiFetch<{ avatar?: string | null }>('GET', '/api/me', { token: token() });
  setMine(me.avatar ?? null);
}

/** 이미 만든 JPEG를 그대로 올린다 */
export async function uploadAvatarJpeg(jpeg: Blob): Promise<string> {
  const r = await fetch(`${serverConfig.apiUrl}/api/me/avatar`, { method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'image/jpeg' }, body: jpeg });
  if (!r.ok) {
    let msg = '사진을 올리지 못했어요';
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg;
    } catch {
      // 본문 없음
    }
    throw new ApiError(r.status, msg);
  }
  const { avatar } = (await r.json()) as { avatar: string };
  setMine(avatar);
  return avatar;
}

/** 폰 사진을 줄여서 올린다 */
export async function uploadAvatar(file: Blob): Promise<string> {
  return uploadAvatarJpeg(await squareJpeg(file));
}

export async function removeAvatar(): Promise<void> {
  await apiFetch('DELETE', '/api/me/avatar', { token: token() });
  setMine(null);
}
