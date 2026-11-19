// 모두의 코스 (설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md 2부, 시안 ⑥⑦⑧):
// 받기(폰에 코스로 담기, 한 번만·같은 모양이면 있는 코스로), 내 코스 공개·고치기·내리기, 신고·이 사람 코스 안 보기, 관리자 동작.
// 목록 정렬(가까운 순)은 폰에서 한다 — 내 위치를 서버에 보내지 않는다. 받은 코스는 기본 코스처럼 오프라인에서도 달린다
import { sameCourseShape } from '../engine/course/edit';
import { courseFromShared, sharedBody } from '../engine/course/share';
import { ApiError, apiFetch } from '../server/api';
import type { Course } from '../types/course';
import type { SharedDetail, SharedSummary } from '../types/shared';
import { getAuth } from './account';
import { loadCourses } from './drive';
import { getDriveRepo } from './recording';
import { assertCourseRoom } from './storageLimits';

export type SharedSort = 'near' | 'adds' | 'new';
export type ReportReason = 'danger' | 'illegal' | 'name' | 'other';
export const REPORT_REASONS: Array<{ id: ReportReason; label: string }> = [
  { id: 'danger', label: '위험한 길' },
  { id: 'illegal', label: '불법 주행 유도' },
  { id: 'name', label: '이름이 불쾌함' },
  { id: 'other', label: '기타' },
];

/** 인기·실시간·즐겨찾기에 쓰는 코스 열쇠: 기본 코스 b:{key}, 받은 코스 s:{공개 번호}, 내 코스는 null */
export function courseKey(c: Pick<Course, 'builtin' | 'shared'>): string | null {
  if (c.builtin) return `b:${c.builtin}`;
  if (c.shared) return `s:${c.shared.id}`;
  return null;
}

function token(): string {
  const a = getAuth();
  if (!a) throw new Error('계정이 있어야 모두의 코스를 쓸 수 있어요');
  return a.token;
}
const call = <T,>(method: string, path: string, body?: unknown) => apiFetch<T>(method, path, { token: token(), body });

const CACHE_MS = 60_000;
let cache: { at: number; list: SharedSummary[] } | null = null;

/** 공개 중인 코스 요약 (쪽을 끝까지 받는다, 1분 기억) */
export async function fetchShared(force = false, now = Date.now()): Promise<SharedSummary[]> {
  if (!force && cache && now - cache.at < CACHE_MS) return cache.list;
  const list: SharedSummary[] = [];
  let after: string | null = null;
  do {
    const r: { items: SharedSummary[]; next: string | null } = await call('GET', `/api/shared${after ? `?after=${encodeURIComponent(after)}` : ''}`);
    list.push(...r.items);
    after = r.next;
  } while (after);
  cache = { at: now, list };
  return list;
}
const forget = () => {
  cache = null;
};

/** 폰에서 정렬. 가까운 순인데 지금 위치를 모르면 많이 받은 순 */
export function sortShared(list: SharedSummary[], by: SharedSort, here: { lat: number; lon: number } | null): SharedSummary[] {
  const out = [...list];
  if (by === 'new') return out.sort((a, b) => b.createdAt - a.createdAt);
  if (by === 'near' && here) {
    const d = (s: SharedSummary) => ((s.start.lat - here.lat) * 111) ** 2 + ((s.start.lon - here.lon) * 88) ** 2;
    return out.sort((a, b) => d(a) - d(b));
  }
  return out.sort((a, b) => b.adds - a.adds || b.createdAt - a.createdAt);
}

export const fetchSharedDetail = (id: string): Promise<SharedDetail> => call('GET', `/api/shared/${encodeURIComponent(id)}`);

/** 이 공개 코스가 이미 폰에 있으면 그 코스 (받은 코스, 또는 내가 올린 원래 코스) */
export async function sharedOnPhone(id: string): Promise<Course | null> {
  return (await getDriveRepo().listCourses()).find((c) => c.shared?.id === id || c.publishedId === id) ?? null;
}

/** 폰의 내 코스에서 공개 표시를 지운다 (서버에서 내려졌을 때) */
export async function forgetPublished(publishedId: string): Promise<void> {
  const drive = getDriveRepo();
  for (const c of await drive.listCourses()) {
    if (c.publishedId !== publishedId) continue;
    const { publishedId: _p, publishedVersion: _v, publishedName: _n, ...rest } = c;
    await drive.putCourse(rest);
  }
  await loadCourses();
}

/** 받기: 이미 받은 코스면 그 코스, 같은 모양 코스가 있으면 그 코스, 아니면 한도를 보고 새로 담는다 */
export async function addSharedToPhone(id: string, known?: SharedDetail): Promise<Course> {
  const drive = getDriveRepo();
  const have = await sharedOnPhone(id);
  if (have) return have;
  const d = known ?? (await fetchSharedDetail(id));
  const fresh = courseFromShared(d, crypto.randomUUID());
  const same = (await drive.listCourses()).find((c) => sameCourseShape(c, fresh));
  if (!same) {
    await assertCourseRoom(drive);
    await drive.putCourse(fresh);
    await loadCourses();
  }
  // 받은 수 (한 사람 한 번, 실패해도 받기는 된 것)
  void call('POST', `/api/shared/${encodeURIComponent(id)}/add`).catch(() => {});
  forget();
  return same ?? fresh;
}

async function mine(courseId: string): Promise<Course> {
  const c = await getDriveRepo().getCourse(courseId);
  if (!c) throw new Error('코스를 찾을 수 없어요');
  if (c.builtin || c.shared) throw new Error('내가 만든 코스만 공개할 수 있어요');
  return c;
}

/** 공개: 줄인 선을 보내고 폰 코스에 공개 번호·그때 버전·이름을 적는다 */
export async function publishCourse(courseId: string, region: string): Promise<string> {
  const c = await mine(courseId);
  const { id } = await call<{ id: string }>('POST', '/api/shared', sharedBody(c, region));
  await getDriveRepo().putCourse({ ...c, publishedId: id, publishedVersion: c.version, publishedName: c.name });
  await loadCourses();
  forget();
  return id;
}

/** 공개 코스도 고친 선·이름으로 바꾸기 (지역은 그대로 둔다 — 서버가 받은 값을 다시 보낸다) */
export async function updatePublished(courseId: string, region = ''): Promise<void> {
  const c = await mine(courseId);
  if (!c.publishedId) throw new Error('공개하지 않은 코스예요');
  let reg = region;
  if (!reg) {
    try {
      reg = (await fetchSharedDetail(c.publishedId)).region;
    } catch {
      reg = '';
    }
  }
  await call('PUT', `/api/shared/${encodeURIComponent(c.publishedId)}`, sharedBody(c, reg));
  await getDriveRepo().putCourse({ ...c, publishedVersion: c.version, publishedName: c.name });
  await loadCourses();
  forget();
}

/** 공개 내리기 (서버에 이미 없으면 그대로 성공) */
export async function unpublish(courseId: string): Promise<void> {
  const c = await getDriveRepo().getCourse(courseId);
  if (!c?.publishedId) return;
  await unpublishById(c.publishedId);
  const { publishedId: _p, publishedVersion: _v, publishedName: _n, ...rest } = c;
  await getDriveRepo().putCourse(rest);
  await loadCourses();
}

/** 공개 번호로 내리기 (폰에 그 코스가 없어도 — 모두의 코스 상세의 "공개 내리기") */
export async function unpublishById(id: string): Promise<void> {
  try {
    await call('DELETE', `/api/shared/${encodeURIComponent(id)}`);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  // 내가 올린 원래 코스면 "공개 중" 표시도 지운다 (검토 지적: 상세에서 내리면 내 코스엔 남았다)
  await forgetPublished(id);
  forget();
}

export async function reportShared(id: string, reason: ReportReason, note?: string): Promise<void> {
  await call('POST', `/api/shared/${encodeURIComponent(id)}/report`, { reason, ...(note?.trim() ? { note: note.trim() } : {}) });
}
export async function blockUser(userId: string): Promise<void> {
  await call('POST', '/api/blocks', { userId });
  forget();
}
export async function unblockUser(userId: string): Promise<void> {
  await call('DELETE', `/api/blocks/${encodeURIComponent(userId)}`);
  forget();
}
export const listBlocks = (): Promise<Array<{ userId: string; nickname: string }>> => call('GET', '/api/blocks');

export type AdminRow = SharedSummary & { status: 'open' | 'hidden'; reports: number; reasons: Partial<Record<ReportReason, number>> };
export const adminList = (): Promise<AdminRow[]> => call('GET', '/api/admin/shared');
export async function adminSet(id: string, action: 'hide' | 'show'): Promise<void> {
  await call('POST', `/api/admin/shared/${encodeURIComponent(id)}`, { action });
  forget();
}
export async function adminDelete(id: string): Promise<void> {
  await unpublishById(id);
}
export async function adminBan(userId: string): Promise<void> {
  await call('POST', '/api/admin/bans', { userId });
  forget();
}
export async function adminUnban(userId: string): Promise<void> {
  await call('DELETE', `/api/admin/bans/${encodeURIComponent(userId)}`);
}
