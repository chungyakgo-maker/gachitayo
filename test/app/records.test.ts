import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '../../src/types/session';

// 기록은 폰에만 2단계 (설계 2026-11-18-local-records-course-share-design.md "기록 지우기"): 업로드는 없고,
// 예전에 서버에 올라간 기록을 지우면 서버 사본도 지운다. 통신이 안 되면 목록에 남겨 다음에 다시
const API = 'https://gachitayo-api.example.workers.dev';
const ME = '11111111-1111-4111-8111-111111111111';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
vi.stubGlobal('localStorage', new MemoryStorage());

const device = { os: 'iOS', browser: 'Safari', userAgent: 'ua', standalone: true };
const session = (id: string, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  courseId: null,
  courseVersion: null,
  status: 'processed',
  startedAt: 1_800_000_000_000,
  endedAt: null,
  device,
  calibration: null,
  summary: null,
  ...extra,
});

let calls: Array<{ method: string; url: string }> = [];
let reply: (method: string, url: string) => Response | Promise<Response> = () => json(200, { ok: true });

async function load() {
  vi.resetModules();
  const rec = await import('../../src/app/recording');
  const records = await import('../../src/app/records');
  return { rec, records };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gachitayo.token', 't'.repeat(43));
  localStorage.setItem('gachitayo.userId', ME);
  localStorage.setItem('gachitayo.onboarded', '1');
  vi.stubEnv('VITE_API_URL', API);
  calls = [];
  reply = () => json(200, { ok: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(input) });
      return reply(method, String(input));
    }),
  );
});

const deletes = () => calls.filter((c) => c.method === 'DELETE').map((c) => c.url.replace(API, ''));

describe('기록 지우기 (폰에만)', () => {
  it('올린 적 있는 기록을 지우면 서버에도 DELETE, 올린 적 없으면 안 부른다', async () => {
    const { rec, records } = await load();
    await rec.getRepo().create(session('up', { status: 'uploaded', uploadedAt: 1 }));
    await rec.getRepo().create(session('local'));
    localStorage.setItem('gachitayo.localOnly.v1', JSON.stringify([ME]));
    await records.deleteSessionRecord('up');
    await records.deleteSessionRecord('local');
    await records.flushServerDeletes();
    expect(deletes()).toEqual(['/api/sessions/up']);
    expect(await rec.getRepo().get('up')).toBeUndefined();
    expect(await rec.getRepo().get('local')).toBeUndefined();
    expect(records.pendingServerDeletes()).toEqual({ sessions: [], courses: [] });
  });

  it('통신 실패면 목록에 남고 flush 때 다시 (성공하면 목록에서 빠짐)', async () => {
    const { rec, records } = await load();
    await rec.getRepo().create(session('up', { status: 'uploaded', uploadedAt: 1 }));
    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    await records.deleteSessionRecord('up');
    await records.flushServerDeletes();
    expect(await rec.getRepo().get('up')).toBeUndefined();
    expect(records.pendingServerDeletes().sessions).toEqual(['up']);
    reply = () => json(200, { ok: true });
    await records.flushServerDeletes();
    expect(records.pendingServerDeletes().sessions).toEqual([]);
    expect(deletes()).toEqual(['/api/sessions/up', '/api/sessions/up']);
  });

  it('서버가 403·404면 목록에서 뺀다 (다른 계정 것·이미 없음), 500이면 남긴다', async () => {
    const { rec, records } = await load();
    for (const id of ['a', 'b', 'c']) await rec.getRepo().create(session(id, { status: 'uploaded', uploadedAt: 1 }));
    reply = (_m, url) => (url.endsWith('/a') ? json(403, { error: '남의 것' }) : url.endsWith('/b') ? json(404, { error: '없음' }) : json(500, { error: '서버 오류' }));
    for (const id of ['a', 'b', 'c']) await records.deleteSessionRecord(id);
    await records.flushServerDeletes();
    await records.flushServerDeletes();
    expect(records.pendingServerDeletes().sessions).toEqual(['c']);
  });

  it('코스 지우기: 서버 코스 행도 지운다. 409(서버에 기록이 남음)면 남겨 두고 기록 지우기 뒤에 다시', async () => {
    const { records } = await load();
    reply = () => json(409, { error: '기록이 남아 있어요' });
    await records.forgetServerCourse('c1');
    await records.flushServerDeletes();
    expect(records.pendingServerDeletes().courses).toEqual(['c1']);
    reply = () => json(200, { ok: true });
    await records.flushServerDeletes();
    expect(records.pendingServerDeletes().courses).toEqual([]);
  });

  it('옮기기를 아직 안 끝낸 계정이면 올린 표시가 없어도 서버에 지우기를 보낸다 (서버에만 남은 사본이 되살아나지 않게)', async () => {
    const { rec, records } = await load();
    await rec.getRepo().create(session('maybe'));
    await records.deleteSessionRecord('maybe');
    await records.flushServerDeletes();
    expect(deletes()).toEqual(['/api/sessions/maybe']);
    localStorage.setItem('gachitayo.localOnly.v1', JSON.stringify([ME]));
    calls = [];
    await rec.getRepo().create(session('local2'));
    await records.deleteSessionRecord('local2');
    await records.flushServerDeletes();
    expect(deletes()).toEqual([]);
  });

  it('통신을 기다리지 않는다: 서버가 답하지 않아도 폰에서는 바로 지워지고 목록에 남는다', async () => {
    const { rec, records } = await load();
    await rec.getRepo().create(session('slow', { status: 'uploaded', uploadedAt: 1 }));
    reply = () => new Promise<Response>(() => {});
    await records.deleteSessionRecord('slow');
    expect(await rec.getRepo().get('slow')).toBeUndefined();
    expect(records.pendingServerDeletes().sessions).toEqual(['slow']);
  });

  it('세션·덩어리·결과·비교 랩을 모두 지운다', async () => {
    const { rec, records } = await load();
    await rec.getRepo().create(session('x', { courseId: 'c1', courseVersion: 1 }));
    await rec.getRepo().putChunk({ sessionId: 'x', seq: 0, gps: [], rawMotion: [], events: [] });
    await rec.getDriveRepo().putRefLaps([{ id: 'x:1', courseId: 'c1', courseVersion: 1, sessionId: 'x', lapNo: 1, startedAt: 1, lapTimeMs: 60_000, sectorTimesMs: [1, 2, 3], trace: { stepM: 5, t: [0], v: [0], alt: [null] } }]);
    await records.deleteSessionRecord('x');
    expect(await rec.getRepo().chunks('x')).toEqual([]);
    expect(await rec.getDriveRepo().refLaps('c1', 1)).toEqual([]);
  });

  it('기록 중인 주행은 지울 수 없어요', async () => {
    vi.resetModules();
    vi.doMock('../../src/app/recording', async (orig) => {
      const m = await orig<typeof import('../../src/app/recording')>();
      return { ...m, getRecordingState: () => ({ ...m.getRecordingState(), sessionId: 'now' }) };
    });
    const records = await import('../../src/app/records');
    await expect(records.deleteSessionRecord('now')).rejects.toThrow('기록 중인 주행은 지울 수 없어요');
    vi.doUnmock('../../src/app/recording');
  });
});

describe('예전 업로드 대기열 정리 (1.0.0 → 1.0.1)', () => {
  it('session-delete·course-delete 만 지우기 목록으로 옮기고 올리기는 버린다. 대기열은 빈다', async () => {
    const { rec, records } = await load();
    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    const q = rec.getQueueRepo();
    await q.enqueue('session', 's-up', 0);
    await q.enqueue('course', 'c-up', 0);
    await q.enqueue('session-delete', 's-del', 0);
    await q.enqueue('course-delete', 'c-del', 0);
    await records.initRecords();
    expect(records.pendingServerDeletes()).toEqual({ sessions: ['s-del'], courses: ['c-del'] });
    expect(await q.count()).toBe(0);
  });

  it('통신이 되면 옮긴 지우기를 바로 보낸다 (기록 먼저, 코스 나중)', async () => {
    const { rec, records } = await load();
    await rec.getQueueRepo().enqueue('course-delete', 'c-del', 0);
    await rec.getQueueRepo().enqueue('session-delete', 's-del', 0);
    await records.initRecords();
    expect(deletes()).toEqual(['/api/sessions/s-del', '/api/courses/c-del']);
    expect(records.pendingServerDeletes()).toEqual({ sessions: [], courses: [] });
  });
});
