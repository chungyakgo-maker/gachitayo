// 백업 파일 만들기·불러오기 (기록은 폰에만 5단계, 설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md, 시안 ②③⑤):
// 기록은 서버에 없으니 폰을 바꿀 땐 이 파일로 옮긴다. 불러오기는 "없는 것만 더한다" — 같은 id 기록은 건너뛰고,
// 기본 코스는 그 폰의 같은 기본 코스(열쇠)로, 같은 모양 코스(sameCourse)는 있는 코스로 잇는다. 코스 한도를 넘으면 아무것도 안 바꾼다.
import { buildBackup, readBackup, type BackupManifest, type BackupSessionInput } from '../backup/backupFile';
import { sameCourseShape } from '../engine/course/edit';
import { shareOrDownload } from '../storage/exportFile';
import { gunzipJson, gzipJson } from '../storage/gzip';
import { buildRawFile, readRawFile } from '../storage/rawFile';
import type { Course } from '../types/course';
import type { SessionRecord } from '../types/session';
import { getCoursePrefs, mergeCoursePrefs } from './coursePrefs';
import { loadCourses } from './drive';
import { BACKUP_REMIND_DAYS, BACKUP_REMIND_MIN } from './limits';
import { getDriveRepo, getRepo, refreshSessions } from './recording';
import { assertCourseRoom, COURSE_LIMIT_TEXT, pruneOldRaw } from './storageLimits';

const LAST_KEY = 'gachitayo.lastBackup.v1';
const SNOOZE_KEY = 'gachitayo.backupSnooze.v1';
const DAY = 86_400_000;

const kstDate = (t: number): string => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
/** 백업에 넣을 기록: 주행 중·일반 주행·되살리는 중인 것은 뺀다 */
const backupable = (s: SessionRecord): boolean => s.status !== 'recording' && !s.noRecord && !s.restoring;

export async function createBackupFile(now = Date.now()): Promise<File> {
  const repo = getRepo();
  const drive = getDriveRepo();
  const courses = await drive.listCourses();
  const list = (await repo.list()).filter(backupable);
  async function* items(): AsyncGenerator<BackupSessionInput> {
    for (const s of list) {
      const chunks = await repo.chunks(s.id);
      yield { session: s, result: (await drive.getResult(s.id)) ?? null, refLaps: await drive.refLapsOfSession(s.id), raw: chunks.length ? await gzipJson(buildRawFile(s, chunks)) : null };
    }
  }
  const blob = await buildBackup({ createdAt: now, courses, prefs: getCoursePrefs(), sessionCount: list.length, sessions: items() });
  return new File([blob], `디고 백업 ${kstDate(now)}.dgo`, { type: 'application/octet-stream' });
}

/** 전체 백업 파일을 만들어 공유 창(앱)·내려받기(웹)로 내보낸다. 내보냈으면 "마지막 백업"을 기억한다.
 *  아이폰 공유 창은 탭 처리 안에서 열어야 해서, 버튼 탭에서 바로 부른다 */
export async function shareBackup(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = await createBackupFile();
  const r = await shareOrDownload(file);
  if (r !== 'cancelled') markBackedUp(file.size);
  return r;
}

/** 불러오기 확인 창에 보일 내용 */
export async function peekBackup(file: Blob): Promise<BackupManifest> {
  return (await readBackup(file)).manifest;
}

export const IMPORT_FAILED = '백업 파일을 다 불러오지 못했어요. 폰 저장 공간을 확인하고 다시 불러와 주세요';

/** 불러오기: 파일이 아니면 "디고 백업 파일이 아니에요", 코스 한도면 한도 문구, 폰에 쓰다가 실패하면(저장 공간 부족 등) IMPORT_FAILED.
 *  기록은 결과·비교 랩·원본을 먼저 쓰고 기록 행을 맨 마지막에 써서, 중간에 실패해도 다시 불러오면 그 기록부터 다시 들어온다 */
export async function importBackup(file: Blob): Promise<{ sessions: number; courses: number; skipped: number }> {
  const c = await readBackup(file);
  try {
    return await importContents(c);
  } catch (e) {
    if (e instanceof Error && e.message === COURSE_LIMIT_TEXT) throw e;
    throw new Error(IMPORT_FAILED);
  }
}

async function importContents(c: Awaited<ReturnType<typeof readBackup>>): Promise<{ sessions: number; courses: number; skipped: number }> {
  const repo = getRepo();
  const drive = getDriveRepo();
  const local = await drive.listCourses();
  // 백업 코스 번호 → 이 폰에서 쓸 코스
  const map = new Map<string, Course>();
  const toAdd: Course[] = [];
  for (const bc of c.courses) {
    const same = bc.builtin ? local.find((l) => l.builtin === bc.builtin) : (local.find((l) => l.id === bc.id) ?? local.find((l) => !l.builtin && sameCourseShape(l, bc)));
    if (same) map.set(bc.id, same);
    else {
      toAdd.push(bc);
      map.set(bc.id, bc);
    }
  }
  const newMine = toAdd.filter((x) => !x.builtin).length;
  await assertCourseRoom(drive, newMine);
  for (const x of toAdd) await drive.putCourse(x);

  const fix = <T extends { courseId: string | null; courseVersion: number | null }>(x: T): T => {
    const m = x.courseId ? map.get(x.courseId) : undefined;
    return m ? { ...x, courseId: m.id, courseVersion: m.version } : x;
  };
  const have = new Set((await repo.list()).map((s) => s.id));
  let added = 0;
  let skipped = 0;
  for (const bs of c.sessions) {
    if (have.has(bs.session.id)) {
      skipped++;
      continue;
    }
    const id = bs.session.id;
    if (bs.result) await drive.putResult(fix(bs.result));
    if (bs.refLaps.length) await drive.putRefLaps(bs.refLaps.map((l) => ({ ...fix(l), sessionId: id })));
    // 원본이 깨져 있으면 그 기록은 원본 없이 들인다 (랩·요약은 남고 "원본 정리됨")
    let rawOk = false;
    const raw = c.raw.get(id);
    if (raw) {
      let r: ReturnType<typeof readRawFile> | null = null;
      try {
        r = readRawFile(await gunzipJson(raw as Uint8Array<ArrayBuffer>));
      } catch {
        r = null;
      }
      if (r) {
        // 지난번에 원본까지 쓰고 기록 행에서 실패했으면 원본이 남아 있다 (덮어쓴다)
        await repo.deleteChunks(id);
        await repo.putChunk({ sessionId: id, seq: 0, gps: r.gps, rawMotion: r.motion, events: r.events, channels: r.channels });
        rawOk = true;
      }
    }
    // 주행 중 끊긴 기록은 계산 전으로 (새 폰에서 "이어서 하기"가 뜨지 않게, 검토 지적)
    const status = bs.session.status === 'interrupted' || bs.session.status === 'recording' ? 'finished' : bs.session.status;
    await repo.create({ ...fix(bs.session), status, restoring: false, ...(raw && !rawOk ? { rawPruned: true } : {}) });
    have.add(id);
    added++;
  }
  mergeCoursePrefs(c.prefs);
  await pruneOldRaw(repo);
  await loadCourses();
  await refreshSessions();
  return { sessions: added, courses: newMine, skipped };
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 저장할 수 없으면 "마지막 백업" 표시만 안 남는다
  }
}

/** 마지막으로 만든 백업 (설정 "마지막 백업 11월 18일 · 38 MB") */
export function lastBackup(): { at: number; bytes: number } | null {
  const v = readJson<{ at: number; bytes: number }>(LAST_KEY);
  return v && typeof v.at === 'number' && typeof v.bytes === 'number' ? v : null;
}
export function markBackedUp(bytes: number, now = Date.now()): void {
  writeJson(LAST_KEY, { at: now, bytes });
}

/** 기록 탭 알림: 기록이 BACKUP_REMIND_MIN 개 이상이고, 마지막 백업(없으면 첫 기록) 뒤 BACKUP_REMIND_DAYS 일이 지났고, 닫은 지 그만큼 안 됐을 때 */
export function backupReminderDue(now: number, sessionCount: number, oldestAt: number | null): boolean {
  if (sessionCount < BACKUP_REMIND_MIN) return false;
  const since = lastBackup()?.at ?? oldestAt;
  if (since === null || now - since < BACKUP_REMIND_DAYS * DAY) return false;
  const snooze = readJson<number>(SNOOZE_KEY);
  return !(typeof snooze === 'number' && now - snooze < BACKUP_REMIND_DAYS * DAY);
}
export function snoozeBackupReminder(now = Date.now()): void {
  writeJson(SNOOZE_KEY, now);
}
