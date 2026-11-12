// 주행 결과와 비교 랩 (사양서 6.4 results, refLaps)
import type { DriveLap, ProcessedTrack } from '../engine/process/processDrive';
import type { LapTrace } from '../engine/delta/trace';
import type { Course } from './course';

/** 세션별 주행 후 처리 결과 */
export interface DriveResultRecord {
  sessionId: string;
  courseId: string | null;
  courseVersion: number | null;
  /** epoch ms */
  processedAt: number;
  laps: DriveLap[];
  theoreticalBest: { sectorsMs: [number, number, number] | null; totalMs: number | null };
  bestLapNo: number | null;
  processed: ProcessedTrack;
  fusion: { gpsOnly: boolean; speedQualityLow: boolean; axisSigns: { accel: 1 | -1; gyro: 1 | -1; confidence: 'high' | 'low' } };
  /** 첫 주행에서 자동으로 만든 코스 (사용자가 저장하기 전, 사양서 8.5) */
  proposedCourse: Course | null;
  /** 이 주행 전의 내 베스트 (개인 기록 갱신 표시용) */
  previousBestMs: number | null;
}

/** 비교 랩 (코스·버전별 유효 랩의 축약 데이터) */
export interface RefLapRecord {
  /** `${sessionId}:${lapNo}` */
  id: string;
  courseId: string;
  courseVersion: number;
  sessionId: string;
  lapNo: number;
  /** 세션 시작 epoch ms ("11월 8일 · 랩 6") */
  startedAt: number;
  lapTimeMs: number;
  sectorTimesMs: [number | null, number | null, number | null];
  trace: LapTrace;
}

/** 세션 요약 (목록 화면용) */
export interface SessionSummary {
  courseName: string | null;
  lapCount: number;
  validLapCount: number;
  bestLapMs: number | null;
}

/** 업로드 대기열 (사양서 6.4 uploadQueue) */
export interface UploadQueueItem {
  /** `${kind}:${targetId}` */
  id: string;
  /** session: 올리기, session-delete: 서버에서 지우기 (기록 지우기), course: 코스만 올리기 (이름·선 바꿈) (M10) */
  kind: 'session' | 'session-delete' | 'course';
  targetId: string;
  attempts: number;
  lastError: string | null;
  /** 다음 시도 시각 epoch ms (지수 백오프) */
  nextAt: number;
  createdAt: number;
}
