// 내부 샘플 형식 (사양서 6.2). 시각 t, tRecv는 "세션 시작부터 ms"(세션 시계)다.

/** GPS 한 점 */
export interface GpsSample {
  /** 수신 시각, 세션 시계 ms */
  tRecv: number;
  /** position.timestamp, epoch ms */
  tFix: number;
  /** 도 */
  lat: number;
  lon: number;
  /** m, 없으면 null */
  alt: number | null;
  altAcc: number | null;
  /** 수평 정확도 m */
  hAcc: number;
  /** m/s, 없으면 null */
  speed: number | null;
  /** 도, 없으면 null */
  heading: number | null;
}

/** 기기 축 원본 모션 (이벤트가 오는 그대로) */
export interface RawMotionSample {
  /** 세션 시계 ms */
  t: number;
  /** 중력 포함 가속도 m/s² */
  gax: number;
  gay: number;
  gaz: number;
  /** 회전 속도 rad/s. 자이로가 없는 기기는 null */
  rx: number | null;
  ry: number | null;
  rz: number | null;
}

export type SessionEventType =
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'gate'
  | 'calibration'
  | 'recalibration'
  | 'gps_lost'
  | 'gps_recovered'
  | 'off_course'
  | 'on_course';

export interface SessionEvent {
  /** 세션 시계 ms */
  t: number;
  type: SessionEventType;
  payload?: Record<string, unknown>;
}
