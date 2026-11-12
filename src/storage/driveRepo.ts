// 주행 결과·코스·비교 랩 저장소 (사양서 6.4)
import type { GachitayoDb } from './db';
import type { Course } from '../types/course';
import type { DriveResultRecord, RefLapRecord } from '../types/drive';

export interface DriveRepo {
  putResult(r: DriveResultRecord): Promise<void>;
  getResult(sessionId: string): Promise<DriveResultRecord | undefined>;
  putCourse(c: Course): Promise<void>;
  getCourse(id: string): Promise<Course | undefined>;
  listCourses(): Promise<Course[]>;
  putRefLaps(laps: RefLapRecord[]): Promise<void>;
  /** 코스·버전의 비교 랩, 빠른 순 */
  refLaps(courseId: string, courseVersion: number): Promise<RefLapRecord[]>;
  bestRefLap(courseId: string, courseVersion: number): Promise<RefLapRecord | null>;
  /** 세션과 그 덩어리·결과·비교 랩을 지운다 */
  deleteSession(sessionId: string): Promise<void>;
  /** 코스와 그 코스의 비교 랩을 지운다 (기록은 따로 먼저 지운다) */
  deleteCourse(courseId: string): Promise<void>;
}

export function createDriveRepo(db: GachitayoDb): DriveRepo {
  const refLaps = async (courseId: string, courseVersion: number) =>
    (await db.refLaps.where('[courseId+courseVersion]').equals([courseId, courseVersion]).toArray()).sort(
      (a, b) => a.lapTimeMs - b.lapTimeMs,
    );
  return {
    async putResult(r) {
      await db.results.put(r);
    },
    getResult: (id) => db.results.get(id),
    async putCourse(c) {
      await db.courses.put(c);
    },
    getCourse: (id) => db.courses.get(id),
    listCourses: () => db.courses.toArray(),
    async putRefLaps(laps) {
      await db.refLaps.bulkPut(laps);
    },
    refLaps,
    async bestRefLap(courseId, courseVersion) {
      return (await refLaps(courseId, courseVersion))[0] ?? null;
    },
    async deleteCourse(courseId) {
      await db.transaction('rw', [db.courses, db.refLaps], async () => {
        await db.refLaps.filter((r) => r.courseId === courseId).delete();
        await db.courses.delete(courseId);
      });
    },
    async deleteSession(sessionId) {
      await db.transaction('rw', [db.sessions, db.chunks, db.results, db.refLaps], async () => {
        await db.chunks.where('sessionId').equals(sessionId).delete();
        await db.results.delete(sessionId);
        await db.refLaps.where('sessionId').equals(sessionId).delete();
        await db.sessions.delete(sessionId);
      });
    },
  };
}
