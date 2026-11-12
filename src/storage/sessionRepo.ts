// 세션·덩어리 저장소 함수. 기록기는 이 인터페이스만 알아서 테스트에서 바꿔 끼울 수 있다.
import type { GachitayoDb } from './db';
import type { ChunkRecord, SessionRecord } from '../types/session';

export interface SessionRepo {
  create(s: SessionRecord): Promise<void>;
  get(id: string): Promise<SessionRecord | undefined>;
  /** 최근 세션부터 */
  list(): Promise<SessionRecord[]>;
  update(id: string, changes: Partial<SessionRecord>): Promise<void>;
  putChunk(c: ChunkRecord): Promise<void>;
  /** seq 순서 */
  chunks(sessionId: string): Promise<ChunkRecord[]>;
  nextSeq(sessionId: string): Promise<number>;
}

export function createSessionRepo(db: GachitayoDb): SessionRepo {
  return {
    async create(s) {
      await db.sessions.add(s);
    },
    get: (id) => db.sessions.get(id),
    list: async () => (await db.sessions.orderBy('startedAt').reverse().toArray()),
    async update(id, changes) {
      await db.sessions.update(id, changes);
    },
    async putChunk(c) {
      await db.chunks.put(c);
    },
    chunks: (sessionId) =>
      db.chunks.where('[sessionId+seq]').between([sessionId, -Infinity], [sessionId, Infinity]).toArray(),
    async nextSeq(sessionId) {
      const last = await db.chunks
        .where('[sessionId+seq]')
        .between([sessionId, -Infinity], [sessionId, Infinity])
        .last();
      return last ? last.seq + 1 : 0;
    },
  };
}
