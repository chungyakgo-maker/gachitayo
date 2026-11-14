import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { GachitayoDb } from '../../src/storage/db';
import { createSessionRepo, type SessionRepo } from '../../src/storage/sessionRepo';
import { Recorder, finishInterrupted, recoverInterrupted, type RecorderDeps } from '../../src/storage/recorder';
import type { DeviceInfo } from '../../src/types/session';
import type { GpsSample, RawMotionSample } from '../../src/types/samples';

const device: DeviceInfo = { os: 'iOS 18.4', browser: 'Safari 18.4', userAgent: 'ua', standalone: true };
const STARTED_AT = 1_800_000_000_000;
let dbCount = 0;

function setup(repoOverride?: (repo: SessionRepo) => SessionRepo) {
  const db = new GachitayoDb(`test-${++dbCount}`);
  const base = createSessionRepo(db);
  const repo = repoOverride ? repoOverride(base) : base;
  let nowEpoch = STARTED_AT;
  const ticks: Array<() => void> = [];
  const deps: RecorderDeps = {
    repo,
    makeClock: (startedAt) => ({ now: () => nowEpoch - startedAt }),
    epochNow: () => nowEpoch,
    every: (_ms, fn) => {
      ticks.push(fn);
      return () => {
        ticks.splice(ticks.indexOf(fn), 1);
      };
    },
  };
  return {
    repo: base,
    deps,
    advance(ms: number) {
      nowEpoch += ms;
    },
    /** 5초 저장 주기 한 번 */
    tick() {
      ticks.forEach((t) => t());
    },
  };
}

const gps = (tRecv: number): GpsSample => ({
  tRecv,
  tFix: STARTED_AT + tRecv,
  lat: 37.5,
  lon: 127,
  alt: null,
  altAcc: null,
  hAcc: 5,
  speed: 10,
  heading: 90,
});
const motion = (t: number): RawMotionSample => ({ t, gax: 0, gay: 0, gaz: 9.8, rx: 0, ry: 0, rz: 0 });

describe('Recorder', () => {
  it('시작하면 기록 중 세션을 만들고, 저장 주기마다 덩어리를 seq 0, 1 순서로 저장한다', async () => {
    const env = setup();
    const rec = await Recorder.start(env.deps, { id: 's1', startedAt: STARTED_AT, device });
    const session = await env.repo.get('s1');
    expect(session?.status).toBe('recording');
    expect(session?.device).toEqual(device);

    env.advance(1000);
    rec.addGps(gps(rec.clock.now()));
    rec.addMotion(motion(rec.clock.now()));
    env.tick();
    await rec.idle();
    env.advance(5000);
    rec.addGps(gps(rec.clock.now()));
    env.tick();
    await rec.idle();

    const chunks = await env.repo.chunks('s1');
    expect(chunks.map((c) => c.seq)).toEqual([0, 1]);
    expect(chunks[0]!.events.map((e) => e.type)).toEqual(['start']);
    expect(chunks[0]!.gps).toEqual([gps(1000)]);
    expect(chunks[0]!.rawMotion).toEqual([motion(1000)]);
    expect(chunks[1]!.gps).toEqual([gps(6000)]);
    expect(rec.stats.chunksSaved).toBe(2);
  });

  it('버퍼가 비어 있으면 덩어리를 저장하지 않는다', async () => {
    const env = setup();
    const rec = await Recorder.start(env.deps, { id: 's1', startedAt: STARTED_AT, device });
    env.tick();
    await rec.idle();
    env.tick();
    await rec.idle();
    expect((await env.repo.chunks('s1')).length).toBe(1);
  });

  it('pause()는 pause 이벤트를 남기고 바로 저장한다', async () => {
    const env = setup();
    const rec = await Recorder.start(env.deps, { id: 's1', startedAt: STARTED_AT, device });
    env.advance(2000);
    rec.addGps(gps(2000));
    await rec.pause();
    const chunks = await env.repo.chunks('s1');
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.events.map((e) => [e.type, e.t, e.payload?.epochMs])).toEqual([
      ['start', 0, STARTED_AT],
      ['pause', 2000, STARTED_AT + 2000],
    ]);
  });

  it('stop()은 stop 이벤트를 저장하고 세션을 끝낸다', async () => {
    const env = setup();
    const rec = await Recorder.start(env.deps, { id: 's1', startedAt: STARTED_AT, device });
    env.advance(7000);
    await rec.stop();
    const session = await env.repo.get('s1');
    expect(session?.status).toBe('finished');
    expect(session?.endedAt).toBe(STARTED_AT + 7000);
    const events = (await env.repo.chunks('s1')).flatMap((c) => c.events);
    expect(events.at(-1)).toEqual({ t: 7000, type: 'stop', payload: { epochMs: STARTED_AT + 7000 } });
  });

  it('저장이 실패하면 오류를 기록하고 버퍼를 지켰다가 다음 저장 때 같은 seq로 저장한다', async () => {
    let failNext = true;
    const env = setup((repo) => ({
      ...repo,
      putChunk: async (c) => {
        if (failNext) {
          failNext = false;
          throw new Error('QuotaExceededError');
        }
        return repo.putChunk(c);
      },
    }));
    const rec = await Recorder.start(env.deps, { id: 's1', startedAt: STARTED_AT, device });
    rec.addGps(gps(100));
    env.tick();
    await rec.idle();
    expect(rec.stats.lastError).toContain('QuotaExceededError');
    expect((await env.repo.chunks('s1')).length).toBe(0);

    rec.addGps(gps(5100));
    env.tick();
    await rec.idle();
    const chunks = await env.repo.chunks('s1');
    expect(chunks.map((c) => c.seq)).toEqual([0]);
    expect(chunks[0]!.gps.map((g) => g.tRecv)).toEqual([100, 5100]);
    expect(rec.stats.lastError).toBeNull();
  });
});

describe('종료할 때 저장 실패', () => {
  it('마지막 저장이 실패하면 오류를 내고, 세션을 끝내지 않으며, 다시 시도하면 모든 샘플을 저장한다', async () => {
    let failing = true;
    const env = setup((repo) => ({
      ...repo,
      putChunk: async (c) => {
        if (failing) throw new Error('QuotaExceededError');
        return repo.putChunk(c);
      },
    }));
    const rec = await Recorder.start(env.deps, { id: 's1', startedAt: STARTED_AT, device });
    rec.addGps(gps(100));
    env.tick();
    await rec.idle();
    env.advance(9000);
    rec.addGps(gps(9000));

    await expect(rec.stop()).rejects.toThrow(/저장/);
    expect((await env.repo.get('s1'))?.status).toBe('recording');

    failing = false;
    await rec.stop();
    const session = await env.repo.get('s1');
    expect(session?.status).toBe('finished');
    const chunks = await env.repo.chunks('s1');
    expect(chunks.flatMap((c) => c.gps).map((g) => g.tRecv)).toEqual([100, 9000]);
    // 다시 시도해도 stop 이벤트는 하나
    expect(chunks.flatMap((c) => c.events).filter((e) => e.type === 'stop')).toHaveLength(1);
  });

  it('화면 갱신 처리에서 오류가 나도 이후 저장은 계속된다', async () => {
    const env = setup();
    let throwOnce = true;
    env.deps.onChange = () => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error('render failed');
      }
    };
    const rec = await Recorder.start(env.deps, { id: 's1', startedAt: STARTED_AT, device });
    env.tick();
    await rec.idle();
    rec.addGps(gps(5000));
    env.tick();
    await rec.idle();
    expect((await env.repo.chunks('s1')).map((c) => c.seq)).toEqual([0, 1]);
  });
});

describe('중단 복구', () => {
  async function killedSession() {
    const env = setup();
    const rec = await Recorder.start(env.deps, { id: 's1', startedAt: STARTED_AT, device });
    env.advance(3000);
    rec.addGps(gps(3000));
    env.tick();
    await rec.idle();
    rec.dispose(); // 앱 강제 종료: stop 없이 사라짐
    return env;
  }

  it('기록 중으로 남은 세션을 중단됨으로 바꿔서 돌려준다', async () => {
    const env = await killedSession();
    const found = await recoverInterrupted(env.repo);
    expect(found.map((s) => [s.id, s.status])).toEqual([['s1', 'interrupted']]);
    expect((await env.repo.get('s1'))?.status).toBe('interrupted');
  });

  it('일반 주행(기록 안 남김)이 중단됐으면 묻지 않고 지운다 (사용자 요청 "일반 주행")', async () => {
    const env = await killedSession();
    await env.repo.update('s1', { noRecord: true });
    const discard = vi.fn(async () => {});
    const found = await recoverInterrupted(env.repo, async () => false, discard);
    expect(found).toEqual([]);
    expect(discard).toHaveBeenCalledWith('s1');
  });

  it('이어서 하면 seq가 이어지고, resume 시각은 마지막 샘플보다 뒤다', async () => {
    const env = await killedSession();
    await recoverInterrupted(env.repo);
    env.advance(60_000);
    const rec = await Recorder.resume(env.deps, 's1');
    expect((await env.repo.get('s1'))?.status).toBe('recording');
    rec.addGps(gps(rec.clock.now()));
    env.tick();
    await rec.idle();
    const chunks = await env.repo.chunks('s1');
    expect(chunks.map((c) => c.seq)).toEqual([0, 1]);
    const resume = chunks[1]!.events[0]!;
    expect(resume.type).toBe('resume');
    expect(resume.payload).toEqual({ afterInterruption: true, epochMs: STARTED_AT + 63_000 });
    expect(resume.t).toBe(63_000);
    expect(resume.t).toBeGreaterThanOrEqual(3000);
  });

  it('다른 창에서 아직 기록 중인 세션은 중단됨으로 바꾸지 않는다', async () => {
    const env = await killedSession();
    const found = await recoverInterrupted(env.repo, async (id) => id === 's1');
    expect(found).toEqual([]);
    expect((await env.repo.get('s1'))?.status).toBe('recording');
  });

  it('이어서 할 때 벽시계가 뒤로 가 있어도 시각이 마지막 샘플보다 작아지지 않는다', async () => {
    const env = await killedSession();
    await recoverInterrupted(env.repo);
    env.advance(-10_000);
    const rec = await Recorder.resume(env.deps, 's1');
    rec.addGps(gps(rec.clock.now()));
    env.tick();
    await rec.idle();
    // 이어서 한 뒤 저장된 덩어리(seq ≥ 1)의 시각은 모두 마지막 샘플(3000) 이상이어야 한다
    const resumed = (await env.repo.chunks('s1')).filter((c) => c.seq >= 1);
    const times = resumed.flatMap((c) => [...c.gps.map((g) => g.tRecv), ...c.events.map((e) => e.t)]);
    expect(times.length).toBeGreaterThan(0);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(3000);
  });

  it('끝내기를 고르면 마지막 샘플 시각으로 끝내고 stop 이벤트를 남긴다', async () => {
    const env = await killedSession();
    await recoverInterrupted(env.repo);
    await finishInterrupted(env.repo, 's1');
    const session = await env.repo.get('s1');
    expect(session?.status).toBe('finished');
    expect(session?.endedAt).toBe(STARTED_AT + 3000);
    const events = (await env.repo.chunks('s1')).flatMap((c) => c.events);
    expect(events.at(-1)).toEqual({ t: 3000, type: 'stop', payload: { afterInterruption: true } });
  });
});

describe('sessionRepo', () => {
  it('같은 세션의 같은 seq 덩어리를 두 번 저장하면 덮어쓰지 않고 실패한다', async () => {
    const env = setup();
    const c = { sessionId: 's1', seq: 0, gps: [], rawMotion: [], events: [] };
    await env.repo.putChunk(c);
    await expect(env.repo.putChunk({ ...c, gps: [gps(1)] })).rejects.toThrow();
    expect((await env.repo.chunks('s1'))[0]!.gps).toEqual([]);
  });
});
