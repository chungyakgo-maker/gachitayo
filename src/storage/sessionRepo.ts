// 세션·덩어리 저장소 함수. 기록기는 이 인터페이스만 알아서 테스트에서 바꿔 끼울 수 있다.
import type { GachitayoDb } from './db';
import type { ChunkRecord, SessionRecord } from '../types/session';

export interface SessionRepo {
  create(s: SessionRecord): Promise<void>;
  get(id: string): Promise<SessionRecord | undefined>;
  /** 최근 세션부터 */
  list(): Promise<SessionRecord[]>;
  update(id: string, changes: Partial<SessionRecord>): Promise<void>;
  /** 같은 (sessionId, seq)가 이미 있으면 실패한다 */
  putChunk(c: ChunkRecord): Promise<void>;
  /** seq 순서 */
  chunks(sessionId: string): Promise<ChunkRecord[]>;
  nextSeq(sessionId: string): Promise<number>;
  /** 원본 덩어리만 지운다 (업로드 뒤 정리) */
  deleteChunks(sessionId: string): Promise<number>;
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
      // put이 아니라 add: 같은 seq가 이미 있으면 덮어쓰지 않고 실패한다 (두 창이 같은 세션에 쓰는 사고 방지)
      await db.chunks.add(c);
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
    deleteChunks: (sessionId) => db.chunks.where('sessionId').equals(sessionId).delete(),
  };
}
