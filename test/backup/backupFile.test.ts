// 백업 파일 (기록은 폰에만 5단계, 시안 ②③): .dgo = ZIP 하나 — manifest·코스·즐겨찾기·기록마다 한 파일·원본(있을 때)
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { buildBackup, readBackup, type BackupSessionInput } from '../../src/backup/backupFile';
import type { Course } from '../../src/types/course';

const course = (id: string, builtin?: string): Course => ({
  id,
  name: id,
  kind: 'loop',
  source: 'auto',
  origin: { lat: 37.2, lon: 127.1 },
  startGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  finishGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  centerline: null,
  lengthM: null,
  sectorBoundsM: null,
  version: 1,
  ...(builtin ? { builtin } : {}),
});
const device = { os: 'iOS', browser: 'Safari', userAgent: 'ua', standalone: true };
const sess = (id: string, raw: Uint8Array | null): BackupSessionInput => ({
  session: { id, courseId: 'c1', courseVersion: 1, status: 'processed', startedAt: 1_800_000_000_000, endedAt: null, device, calibration: null, summary: null },
  result: { sessionId: id, courseId: 'c1', courseVersion: 1, processedAt: 1, laps: [{ lapNo: 1, valid: true, lapTimeMs: 61_234 }] } as never,
  refLaps: [{ id: `${id}:1`, courseId: 'c1', courseVersion: 1, sessionId: id, lapNo: 1, startedAt: 1, lapTimeMs: 61_234, sectorTimesMs: [1, 2, 3], trace: { stepM: 5, t: [0], v: [0], alt: [null] } }],
  raw,
});
async function* gen(list: BackupSessionInput[]) {
  for (const s of list) yield s;
}

describe('buildBackup / readBackup', () => {
  it('묶고 풀면 같다 (코스 2·기록 3, 원본 2개)', async () => {
    const raw = new Uint8Array([31, 139, 8, 0, 1, 2, 3]);
    const blob = await buildBackup({ createdAt: 1_900_000_000_000, courses: [course('c1'), course('b1', 'haogogae')], prefs: { favorites: ['b:haogogae'], tags: {} }, sessionCount: 3, sessions: gen([sess('s1', raw), sess('s2', null), sess('s3', raw)]) });
    const got = await readBackup(blob);
    // 코스 수는 내 코스만 (기본 코스는 세지 않는다, 확인 창 "내 코스 N개")
    expect(got.manifest).toEqual({ format: 'dgo-backup', version: 1, createdAt: 1_900_000_000_000, sessions: 3, courses: 1 });
    expect(got.courses.map((c) => c.id)).toEqual(['c1', 'b1']);
    expect(got.prefs.favorites).toEqual(['b:haogogae']);
    expect(got.sessions.map((s) => s.session.id).sort()).toEqual(['s1', 's2', 's3']);
    expect(got.sessions.find((s) => s.session.id === 's1')!.refLaps[0]!.lapTimeMs).toBe(61_234);
    expect([...got.raw.keys()].sort()).toEqual(['s1', 's3']);
    expect([...got.raw.get('s1')!]).toEqual([...raw]);
  });

  it('디고 백업 파일이 아니에요: 아무 ZIP, 깨진 바이트, 모르는 판', async () => {
    const msg = '디고 백업 파일이 아니에요';
    await expect(readBackup(new Blob([zipSync({ 'a.txt': strToU8('hi') }) as BlobPart]))).rejects.toThrow(msg);
    await expect(readBackup(new Blob([new Uint8Array([1, 2, 3, 4])]))).rejects.toThrow(msg);
    const v99 = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'dgo-backup', version: 99, createdAt: 1, sessions: 0, courses: 0 })), 'courses.json': strToU8('[]'), 'prefs.json': strToU8('{"favorites":[],"tags":{}}') });
    await expect(readBackup(new Blob([v99 as BlobPart]))).rejects.toThrow(msg);
  });
});
