// 기록기 (사양서 6.4, 9장 앱 중단): 샘플을 메모리에 모았다가 5초마다 덩어리로 저장한다.
// 화면이 가려지면 바로 저장해서, 앱이 강제 종료돼도 잃는 데이터를 최소로 한다.
import type { SessionClock } from '../normalize/sessionClock';
import type { GpsSample, RawMotionSample, SessionEvent, SessionEventType } from '../types/samples';
import type { ChunkRecord, DeviceInfo, SessionRecord } from '../types/session';
import type { SessionRepo } from './sessionRepo';

/** 덩어리 저장 주기 (사양서 6.4) */
export const CHUNK_INTERVAL_MS = 5000;

export interface RecorderDeps {
  repo: SessionRepo;
  /** 세션 시작 시각(epoch ms)으로 세션 시계를 만든다 */
  makeClock: (startedAtEpochMs: number) => SessionClock;
  /** 벽시계 epoch ms (기본: Date.now). 시작·멈춤·이어서·종료 이벤트에 함께 남긴다 */
  epochNow?: () => number;
  /** ms마다 fn을 부르고, 멈추는 함수를 돌려준다 (기본: setInterval) */
  every?: (ms: number, fn: () => void) => () => void;
  /** 저장 상태가 바뀌면 부른다 (화면 갱신용) */
  onChange?: () => void;
}

export interface RecorderStats {
  chunksSaved: number;
  lastError: string | null;
}

interface Buffer {
  gps: GpsSample[];
  rawMotion: RawMotionSample[];
  events: SessionEvent[];
}

const emptyBuffer = (): Buffer => ({ gps: [], rawMotion: [], events: [] });

/** 덩어리들에서 가장 늦은 샘플·이벤트 시각 (세션 시계 ms) */
function lastTime(chunks: ChunkRecord[]): number {
  let t = 0;
  for (const c of chunks) {
    for (const g of c.gps) t = Math.max(t, g.tRecv);
    for (const m of c.rawMotion) t = Math.max(t, m.t);
    for (const e of c.events) t = Math.max(t, e.t);
  }
  return t;
}

const defaultEvery = (ms: number, fn: () => void) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

export class Recorder {
  readonly stats: RecorderStats = { chunksSaved: 0, lastError: null };
  private buffer: Buffer = emptyBuffer();
  private chain: Promise<void> = Promise.resolve();
  private stopTimer: () => void;
  /** stop()을 처음 부른 시점의 세션 시계 ms (다시 시도해도 바뀌지 않음) */
  private stopAt: number | null = null;

  private constructor(
    private readonly deps: RecorderDeps,
    readonly sessionId: string,
    readonly startedAt: number,
    readonly clock: SessionClock,
    private seq: number,
  ) {
    this.stopTimer = (deps.every ?? defaultEvery)(CHUNK_INTERVAL_MS, () => void this.flush());
  }

  /** 새 세션을 만들고 기록을 시작한다. */
  static async start(
    deps: RecorderDeps,
    init: { id: string; startedAt: number; device: DeviceInfo },
  ): Promise<Recorder> {
    await deps.repo.create({
      id: init.id,
      courseId: null,
      courseVersion: null,
      status: 'recording',
      startedAt: init.startedAt,
      endedAt: null,
      device: init.device,
      calibration: null,
      summary: null,
    });
    const rec = new Recorder(deps, init.id, init.startedAt, deps.makeClock(init.startedAt), 0);
    rec.markEvent('start');
    return rec;
  }

  /** 중단된 세션을 이어서 기록한다. */
  static async resume(deps: RecorderDeps, sessionId: string): Promise<Recorder> {
    const session = await deps.repo.get(sessionId);
    if (!session) throw new Error(`세션 없음: ${sessionId}`);
    const chunks = await deps.repo.chunks(sessionId);
    const seq = chunks.length > 0 ? chunks[chunks.length - 1]!.seq + 1 : 0;
    // 벽시계가 뒤로 가 있어도(시간 동기화 등) 세션 시계가 마지막 샘플보다 작아지지 않게 한다 (사양서 6.1 단조 증가)
    const base = deps.makeClock(session.startedAt);
    const lag = Math.max(0, lastTime(chunks) - base.now());
    const clock: SessionClock = lag > 0 ? { now: () => base.now() + lag } : base;
    await deps.repo.update(sessionId, { status: 'recording' });
    const rec = new Recorder(deps, sessionId, session.startedAt, clock, seq);
    rec.markEvent('resume', { afterInterruption: true });
    return rec;
  }

  addGps(s: GpsSample): void {
    this.buffer.gps.push(s);
  }

  addMotion(s: RawMotionSample): void {
    this.buffer.rawMotion.push(s);
  }

  addEvent(type: SessionEventType, payload?: Record<string, unknown>): void {
    const e: SessionEvent = { t: this.clock.now(), type };
    if (payload) e.payload = payload;
    this.buffer.events.push(e);
  }

  /** 시작·멈춤·이어서·종료·주행 시작 이벤트: 나중에 실제 시각과 맞춰 볼 수 있게 벽시계 시각을 함께 남긴다. */
  markEvent(type: SessionEventType, payload: Record<string, unknown> = {}): void {
    this.addEvent(type, { ...payload, epochMs: (this.deps.epochNow ?? Date.now)() });
  }

  /** 버퍼를 덩어리 하나로 저장한다. 실패하면 버퍼를 되돌려 다음 저장 때 다시 시도한다. */
  flush(): Promise<void> {
    // 어떤 오류가 나도 저장 사슬이 끊기지 않게 한다 (끊기면 이후 저장이 모두 건너뛰어진다)
    this.chain = this.chain.then(() => this.saveBuffer()).catch(() => undefined);
    return this.chain;
  }

  /** 지금까지 요청한 저장이 모두 끝날 때까지 기다린다. */
  idle(): Promise<void> {
    return this.chain;
  }

  /** 화면이 가려질 때: pause 이벤트를 남기고 바로 저장한다. payload: 아이폰 앱이면 { backgroundGps: true } (위치는 이어진다) */
  pause(payload: Record<string, unknown> = {}): Promise<void> {
    this.markEvent('pause', payload);
    return this.flush();
  }

  /** 화면이 다시 보일 때 */
  unpause(): void {
    this.markEvent('resume');
  }

  /**
   * 기록을 끝낸다. 마지막 저장이 실패하면 오류를 내고 세션을 끝내지 않는다.
   * 버퍼는 그대로 남아 있으므로, 공간을 확보한 뒤 다시 부르면 된다.
   */
  async stop(): Promise<void> {
    if (this.stopAt === null) {
      this.stopAt = this.clock.now();
      this.markEvent('stop');
      this.stopTimer();
    }
    await this.flush();
    if (this.stats.lastError) {
      throw new Error(`마지막 저장 실패: ${this.stats.lastError}`);
    }
    await this.deps.repo.update(this.sessionId, {
      status: 'finished',
      endedAt: this.startedAt + this.stopAt,
    });
    this.deps.onChange?.();
  }

  /** 저장 주기를 멈춘다 (stop 없이 버릴 때, 테스트용). */
  dispose(): void {
    this.stopTimer();
  }

  private async saveBuffer(): Promise<void> {
    const b = this.buffer;
    if (b.gps.length === 0 && b.rawMotion.length === 0 && b.events.length === 0) return;
    this.buffer = emptyBuffer();
    try {
      await this.deps.repo.putChunk({ sessionId: this.sessionId, seq: this.seq, ...b });
      this.seq += 1;
      this.stats.chunksSaved += 1;
      this.stats.lastError = null;
    } catch (e) {
      // 그 사이 들어온 샘플 앞에 되돌려 놓는다
      this.buffer = {
        gps: [...b.gps, ...this.buffer.gps],
        rawMotion: [...b.rawMotion, ...this.buffer.rawMotion],
        events: [...b.events, ...this.buffer.events],
      };
      this.stats.lastError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    this.deps.onChange?.();
  }
}

/**
 * 앱 시작 때 부른다. 이 페이지에서는 아직 기록을 시작하지 않았으므로,
 * '기록 중'으로 남은 세션은 이전 실행이 중단된 것이다.
 */
export async function recoverInterrupted(
  repo: SessionRepo,
  /** 다른 창에서 지금 기록 중인 세션인지 (그런 세션은 건드리지 않는다) */
  isLive: (sessionId: string) => Promise<boolean> = async () => false,
) {
  const sessions = await repo.list();
  const candidates = sessions.filter((s) => s.status === 'recording' || s.status === 'interrupted');
  const found: SessionRecord[] = [];
  for (const s of candidates) {
    if (!(await isLive(s.id))) found.push(s);
  }
  for (const s of found) {
    if (s.status === 'recording') await repo.update(s.id, { status: 'interrupted' });
  }
  return found.map((s) => ({ ...s, status: 'interrupted' as const }));
}

/** 중단된 세션을 이어서 하지 않고 끝낸다. 끝난 시각은 마지막으로 저장된 샘플 시각이다. */
export async function finishInterrupted(repo: SessionRepo, sessionId: string): Promise<void> {
  const session = await repo.get(sessionId);
  if (!session) return;
  const chunks = await repo.chunks(sessionId);
  const lastT = lastTime(chunks);
  await repo.putChunk({
    sessionId,
    seq: await repo.nextSeq(sessionId),
    gps: [],
    rawMotion: [],
    events: [{ t: lastT, type: 'stop', payload: { afterInterruption: true } }],
  });
  await repo.update(sessionId, { status: 'finished', endedAt: session.startedAt + lastT });
}
