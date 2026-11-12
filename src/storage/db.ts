// 폰 저장소 IndexedDB (사양서 6.4). uploadQueue는 동기화(M6)에서 버전을 올려 추가한다.
import Dexie, { type Table } from 'dexie';
import type { Course } from '../types/course';
import type { DriveResultRecord, RefLapRecord } from '../types/drive';
import type { ChunkRecord, SessionRecord } from '../types/session';

export class GachitayoDb extends Dexie {
  sessions!: Table<SessionRecord, string>;
  chunks!: Table<ChunkRecord, [string, number]>;
  results!: Table<DriveResultRecord, string>;
  courses!: Table<Course, string>;
  refLaps!: Table<RefLapRecord, string>;

  constructor(name = 'gachitayo') {
    super(name);
    this.version(1).stores({
      sessions: 'id, status, startedAt',
      chunks: '[sessionId+seq], sessionId',
    });
    // M5: 주행 결과, 코스, 비교 랩
    this.version(2).stores({
      results: 'sessionId',
      courses: 'id',
      refLaps: 'id, [courseId+courseVersion], sessionId',
    });
  }
}
