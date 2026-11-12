// 폰 저장소의 세션과 덩어리 (사양서 6.4)
import type { GpsSample, RawMotionSample, SessionEvent } from './samples';
import type { SessionSummary } from './drive';

export interface DeviceInfo {
  os: string;
  browser: string;
  userAgent: string;
  /** 홈 화면에 설치한 앱으로 열었는지 */
  standalone: boolean;
  /** 기기 모델 (안드로이드 크롬에서만 얻을 수 있음) */
  model?: string;
}

export type SessionStatus = 'recording' | 'interrupted' | 'finished' | 'processed' | 'uploaded';

export interface SessionRecord {
  /** UUID, 폰에서 생성 */
  id: string;
  courseId: string | null;
  courseVersion: number | null;
  status: SessionStatus;
  /** epoch ms. 세션 시계의 0점 */
  startedAt: number;
  /** epoch ms */
  endedAt: number | null;
  device: DeviceInfo;
  /** 거치 보정 결과 (M3부터) */
  calibration: null;
  /** 요약 (주행 후 처리 뒤) */
  summary: SessionSummary | null;
}

/** 5초 단위로 저장하는 원본 덩어리 */
export interface ChunkRecord {
  sessionId: string;
  seq: number;
  gps: GpsSample[];
  rawMotion: RawMotionSample[];
  events: SessionEvent[];
}
