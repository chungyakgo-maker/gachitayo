// 업로드 대기열 (사양서 6.4, 9장: 통신 없음 → 대기열에 넣고 지수 백오프로 재시도)
import type { GachitayoDb } from './db';
import type { UploadQueueItem } from '../types/drive';

export interface QueueRepo {
  /** 넣는다. 이미 있으면 시도 횟수를 처음부터 다시 세고 바로 시도하게 한다 */
  enqueue(kind: UploadQueueItem['kind'], targetId: string, now: number): Promise<void>;
  /** 시도할 때가 된 것, 오래된 순 */
  due(now: number): Promise<UploadQueueItem[]>;
  all(): Promise<UploadQueueItem[]>;
  update(item: UploadQueueItem): Promise<void>;
  remove(id: string): Promise<void>;
  count(): Promise<number>;
}

export function createQueueRepo(db: GachitayoDb): QueueRepo {
  return {
    async enqueue(kind, targetId, now) {
      const id = `${kind}:${targetId}`;
      const old = await db.uploadQueue.get(id);
      await db.uploadQueue.put({ id, kind, targetId, attempts: 0, lastError: null, nextAt: now, createdAt: old?.createdAt ?? now });
    },
    async due(now) {
      return (await db.uploadQueue.where('nextAt').belowOrEqual(now).toArray()).sort((a, b) => a.createdAt - b.createdAt);
    },
    all: () => db.uploadQueue.toArray(),
    async update(item) {
      await db.uploadQueue.put(item);
    },
    async remove(id) {
      await db.uploadQueue.delete(id);
    },
    count: () => db.uploadQueue.count(),
  };
}
