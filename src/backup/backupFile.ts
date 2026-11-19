// 백업 파일 (기록은 폰에만 5단계, 설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md "백업 파일", 시안 ②③):
// 기록은 폰에만 있으니 폰을 바꿀 때 옮길 수단이 파일 하나다. ".dgo" = ZIP(공유·"파일"에 저장하기 쉬운 한 파일):
//   manifest.json   { format: 'dgo-backup', version: 1, createdAt, sessions, courses(내 코스 수, 기본 코스 빼고) }
//   courses.json    Course[] (기본 코스도 넣는다 — 불러올 때 기본 코스 열쇠로 그 폰의 기본 코스에 잇는다)
//   prefs.json      즐겨찾기·분류
//   sessions/{id}.json   { session, result, refLaps } (기록마다 한 파일)
//   raw/{id}.raw.json.gz 원본 파일 (남아 있는 것만, 이미 gzip 이라 ZIP 에선 저장만)
// 묶을 때 기록을 하나씩 받아(AsyncIterable) 바로 ZIP 조각으로 내보낸다: 원본 전부를 한꺼번에 메모리에 올리지 않게.
import { Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8, unzipSync } from 'fflate';
import type { CoursePrefs } from '../app/coursePrefs';
import type { Course } from '../types/course';
import type { DriveResultRecord, RefLapRecord } from '../types/drive';
import type { SessionRecord } from '../types/session';

export interface BackupManifest {
  format: 'dgo-backup';
  version: 1;
  createdAt: number;
  sessions: number;
  courses: number;
}
export interface BackupSession {
  session: SessionRecord;
  result: DriveResultRecord | null;
  refLaps: RefLapRecord[];
}
export interface BackupSessionInput extends BackupSession {
  /** gzip 한 원본 파일 (없으면 null) */
  raw: Uint8Array | null;
}
export interface BackupInput {
  createdAt: number;
  courses: Course[];
  prefs: CoursePrefs;
  /** manifest 에 적을 기록 수 (sessions 를 다 읽기 전에 적는다) */
  sessionCount: number;
  sessions: AsyncIterable<BackupSessionInput>;
}
export interface BackupContents {
  manifest: BackupManifest;
  courses: Course[];
  prefs: CoursePrefs;
  sessions: BackupSession[];
  /** 기록 id → gzip 원본 */
  raw: Map<string, Uint8Array>;
}

export const NOT_BACKUP = '디고 백업 파일이 아니에요';

export function buildBackup(input: BackupInput): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const parts: Uint8Array[] = [];
    const zip = new Zip((err, chunk, final) => {
      if (err) return reject(err);
      parts.push(chunk);
      if (final) resolve(new Blob(parts as BlobPart[], { type: 'application/octet-stream' }));
    });
    const put = (name: string, data: Uint8Array, compress: boolean) => {
      const f = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
      zip.add(f);
      f.push(data, true);
    };
    const json = (name: string, v: unknown) => put(name, strToU8(JSON.stringify(v)), true);
    void (async () => {
      const manifest: BackupManifest = { format: 'dgo-backup', version: 1, createdAt: input.createdAt, sessions: input.sessionCount, courses: input.courses.filter((c) => !c.builtin).length };
      json('manifest.json', manifest);
      json('courses.json', input.courses);
      json('prefs.json', input.prefs);
      for await (const s of input.sessions) {
        json(`sessions/${s.session.id}.json`, { session: s.session, result: s.result, refLaps: s.refLaps } satisfies BackupSession);
        if (s.raw) put(`raw/${s.session.id}.raw.json.gz`, s.raw, false);
      }
      zip.end();
    })().catch((e: unknown) => {
      zip.terminate();
      reject(e);
    });
  });
}

const parse = (bytes: Uint8Array | undefined): unknown => {
  if (!bytes) throw new Error(NOT_BACKUP);
  return JSON.parse(strFromU8(bytes));
};

export async function readBackup(file: Blob): Promise<BackupContents> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error(NOT_BACKUP);
  }
  try {
    const manifest = parse(files['manifest.json']) as BackupManifest;
    if (manifest?.format !== 'dgo-backup' || manifest.version !== 1) throw new Error(NOT_BACKUP);
    const courses = parse(files['courses.json']) as Course[];
    const prefs = parse(files['prefs.json']) as CoursePrefs;
    if (!Array.isArray(courses) || !prefs || !Array.isArray(prefs.favorites)) throw new Error(NOT_BACKUP);
    const sessions: BackupSession[] = [];
    const raw = new Map<string, Uint8Array>();
    for (const [name, bytes] of Object.entries(files)) {
      const s = /^sessions\/(.+)\.json$/.exec(name);
      if (s) {
        const v = parse(bytes) as BackupSession;
        if (!v?.session?.id) throw new Error(NOT_BACKUP);
        sessions.push({ session: v.session, result: v.result ?? null, refLaps: Array.isArray(v.refLaps) ? v.refLaps : [] });
      }
      const r = /^raw\/(.+)\.raw\.json\.gz$/.exec(name);
      if (r) raw.set(r[1]!, bytes);
    }
    return { manifest, courses, prefs: { favorites: prefs.favorites, tags: prefs.tags ?? {} }, sessions, raw };
  } catch {
    throw new Error(NOT_BACKUP);
  }
}
