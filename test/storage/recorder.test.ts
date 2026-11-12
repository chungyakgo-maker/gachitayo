import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
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
    expect(chunks[0]!.events.map((e) => [e.type, e.t])).toEqual([
      ['start', 0],
      ['pause', 2000],
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
    expect(events.at(-1)).toEqual({ t: 7000, type: 'stop' });
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
    expect(resume.payload).toEqual({ afterInterruption: true });
    expect(resume.t).toBe(63_000);
    expect(resume.t).toBeGreaterThanOrEqual(3000);
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
