import 'fake-indexeddb/auto';
// 인기 도로 새 신호 (기록은 폰에만 4단계): 기본 코스로 랩·편도를 1번 이상 마친 주행을 처리하면 코스 열쇠만 보낸다 (위치 없음)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '../../src/types/course';
import type { DriveResultRecord } from '../../src/types/drive';

vi.mock('../../src/app/account', () => ({ getAuth: () => ({ userId: 'u1', token: 'tok' }) }));
const posts: Array<{ url: string; body: unknown }> = [];
beforeEach(() => {
  posts.length = 0;
  vi.stubEnv('VITE_API_URL', 'https://api.example.workers.dev');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const NOW = 1_900_000_000_000;
const lap = { lapNo: 1, valid: true } as DriveResultRecord['laps'][number];
const result = (laps: DriveResultRecord['laps']) => ({ laps }) as DriveResultRecord;
const builtin = { id: 'c1', builtin: 'haogogae' } as Course;
const mine = { id: 'c2' } as Course;

describe('droveKeyOf / reportDrove', () => {
  it('기본 코스 + 유효 랩 1개 이상 + 오늘 달린 주행 → b:{key}', async () => {
    const { droveKeyOf } = await import('../../src/app/droveSignal');
    expect(droveKeyOf(result([lap]), builtin, NOW - 3_600_000, NOW)).toBe('b:haogogae');
  });

  it('내 코스·코스 없음·유효 랩 없음·하루 넘은 주행(다시 계산)은 안 보낸다', async () => {
    const { droveKeyOf } = await import('../../src/app/droveSignal');
    expect(droveKeyOf(result([lap]), mine, NOW, NOW)).toBeNull();
    expect(droveKeyOf(result([lap]), null, NOW, NOW)).toBeNull();
    expect(droveKeyOf(result([{ ...lap, valid: false }]), builtin, NOW, NOW)).toBeNull();
    expect(droveKeyOf(result([lap]), builtin, NOW - 25 * 3_600_000, NOW)).toBeNull();
  });

  it('reportDrove 는 /api/drove 에 코스 열쇠만 보낸다', async () => {
    const { reportDrove } = await import('../../src/app/droveSignal');
    await reportDrove('b:haogogae');
    expect(posts).toEqual([{ url: 'https://api.example.workers.dev/api/drove', body: { course: 'b:haogogae' } }]);
  });
});

describe('주행 처리 뒤 신호 (drive.processSession)', () => {
  it('기본 코스 주행을 처리하면 한 번 보낸다', async () => {
    vi.doMock('../../src/app/sessionProcessing', async (orig) => ({
      ...(await orig<typeof import('../../src/app/sessionProcessing')>()),
      processStoredSession: async (_d: unknown, id: string) => ({ sessionId: id, courseId: 'bc1', courseVersion: 1, laps: [{ lapNo: 1, valid: true }] }),
    }));
    const rec = await import('../../src/app/recording');
    const drive = await import('../../src/app/drive');
    await rec.getDriveRepo().putCourse({ id: 'bc1', builtin: 'haogogae', name: '하오고개', kind: 'loop', source: 'auto', origin: { lat: 37, lon: 127 }, startGate: { lat: 37, lon: 127, bearingDeg: 0, widthM: 30 }, finishGate: { lat: 37, lon: 127, bearingDeg: 0, widthM: 30 }, centerline: null, lengthM: null, sectorBoundsM: null, version: 1 });
    await rec.getRepo().create({ id: 'd1', courseId: 'bc1', courseVersion: 1, status: 'finished', startedAt: Date.now() - 60_000, endedAt: null, device: { os: 'iOS', browser: 'Safari', userAgent: 'ua', standalone: true }, calibration: null, summary: null });
    await drive.processSession('d1');
    for (let i = 0; i < 20 && posts.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(posts.map((p) => p.body)).toEqual([{ course: 'b:haogogae' }]);
    vi.doUnmock('../../src/app/sessionProcessing');
  });
});
