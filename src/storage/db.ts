// 폰 저장소 IndexedDB (사양서 6.4). results, courses, refLaps, uploadQueue는 쓰는 마일스톤에서 버전을 올려 추가한다.
import Dexie, { type Table } from 'dexie';
import type { ChunkRecord, SessionRecord } from '../types/session';

export class GachitayoDb extends Dexie {
  sessions!: Table<SessionRecord, string>;
  chunks!: Table<ChunkRecord, [string, number]>;

  constructor(name = 'gachitayo') {
    super(name);
    this.version(1).stores({
      sessions: 'id, status, startedAt',
      chunks: '[sessionId+seq], sessionId',
    });
  }
}
