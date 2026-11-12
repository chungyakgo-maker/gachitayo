// 주행 중 엔진 (사양서 5.3, 8.4): 융합 점 하나를 넣으면 주행 화면에 필요한 상태가 나온다.
// 게이트 통과·랩·구간, 코스 거리, 델타(10 Hz, 0.3초 평활), G(지난 0.2초), 상태 표시.
import { config } from '../config';
import type { CourseGeometry } from '../course/geometry';
import { GateDetector } from '../course/gates';
import { STracker } from '../course/sTracker';
import { DeltaFilter, rawDelta } from '../delta/delta';
import type { LapTrace } from '../delta/trace';
import { GForceSmoother } from '../derive/gforce';

export interface LiveInput {
  /** 세션 시계 ms */
  t: number;
  x: number;
  y: number;
  /** m/s */
  v: number;
  /** 융합 위치 표준편차 m */
  sigmaPos: number;
  /** 차 기준 가속도 m/s² (보정 전이면 null) */
  ax: number | null;
  ay: number | null;
  /** 최근에 GPS를 받았는지 */
  gpsOk: boolean;
  gCalibrated: boolean;
}

export interface CompletedLap {
  lapNo: number;
  timeMs: number;
  /** 통과 시각 (세션 시계 ms). 화면은 이 뒤 3초 동안 크게 보여준다 */
  t: number;
  valid: boolean;
  sectorTimesMs: [number | null, number | null, number | null];
}

export interface LiveState {
  t: number;
  speedKmh: number;
  /** 지금 랩 번호 (첫 출발선 통과 전 0) */
  lapNo: number;
  /** 지금 랩 경과 ms (첫 주행·코스 없음이면 출발 뒤 경과) */
  lapElapsedMs: number | null;
  lastLap: CompletedLap | null;
  /** 이번 세션 베스트 (유효 랩) */
  bestLapMs: number | null;
  /** 지금 랩 구간 기록 */
  sectorTimesMs: [number | null, number | null, number | null];
  /** 초, + 느림. 숨김이면 null */
  delta: number | null;
  s: number | null;
  onCourse: boolean;
  gx: number | null;
  gy: number | null;
  status: { gpsWeak: boolean; offCourse: boolean; gNotCalibrated: boolean; courseRecording: boolean };
}

/**
 * 출발선을 막 지났는데 코스 거리가 아직 둘레 끝으로 읽히면(출발선과 중심선 각도가 조금 달라서) 0으로 본다.
 * 그대로 두면 델타가 한 바퀴만큼 튄다.
 */
export function lapProgress(s: number | null, length: number | null, lapElapsedMs: number | null): number | null {
  if (s === null || length === null || lapElapsedMs === null) return s;
  return s > length - LAP_START_WINDOW_M && lapElapsedMs < LAP_START_WINDOW_MS ? 0 : s;
}
const LAP_START_WINDOW_M = 50;
const LAP_START_WINDOW_MS = 10_000;

export class LiveEngine {
  private readonly det: GateDetector | null;
  private readonly st: STracker | null;
  private readonly filter = new DeltaFilter();
  private readonly g = new GForceSmoother();
  private lapNo = 0;
  private lapStartT: number | null = null;
  private lapValid = true;
  private lastLap: CompletedLap | null = null;
  private bestLapMs: number | null = null;
  private sectorCross: [number | null, number | null] = [null, null];
  private prev: { t: number; s: number | null } | null = null;
  private lastDeltaT = -Infinity;
  private delta: number | null = null;
  private firstMoveT: number | null = null;
  private gpsBadSince: number | null = null;

  constructor(
    private readonly geom: CourseGeometry | null,
    private readonly ref: { trace: LapTrace; lapTimeMs: number } | null,
  ) {
    this.det = geom ? new GateDetector(geom) : null;
    this.st = geom?.centerline ? new STracker(geom) : null;
  }

  push(p: LiveInput): LiveState {
    const g = p.ax !== null && p.ay !== null && p.gCalibrated ? this.g.push(p.t, p.ax, p.ay) : null;
    const status = { gpsWeak: !p.gpsOk, offCourse: false, gNotCalibrated: !p.gCalibrated, courseRecording: false };

    if (!this.geom) {
      // 첫 주행: 코스가 아직 없다. 속도와 출발 뒤 경과 시간만
      if (this.firstMoveT === null && p.v > config.course.auto.startSpeedMps) this.firstMoveT = p.t;
      return this.state(p, g, null, true, { ...status, courseRecording: true }, this.firstMoveT === null ? null : p.t - this.firstMoveT);
    }

    for (const c of this.det!.push(p.t, p.x, p.y)) {
      if (this.geom.course.kind === 'loop') {
        if (this.lapStartT !== null) this.completeLap(c.t);
        this.startLap(c.t);
      } else if (c.gate === 'start') {
        this.startLap(c.t);
      } else if (this.lapStartT !== null) {
        this.completeLap(c.t);
        this.lapStartT = null;
      }
    }

    const tr = this.st ? this.st.update(p.x, p.y, p.v, p.t) : { s: null as number | null, onCourse: true };
    tr.s = lapProgress(tr.s, this.geom.centerline?.length ?? null, this.lapStartT === null ? null : p.t - this.lapStartT);
    status.offCourse = !tr.onCourse;

    // GPS 5초 넘게 끊기거나 코스를 벗어나면 이 랩은 무효
    if (!p.gpsOk) this.gpsBadSince ??= p.t;
    else this.gpsBadSince = null;
    if (!tr.onCourse || (this.gpsBadSince !== null && p.t - this.gpsBadSince > config.laps.maxGpsGapS * 1000)) this.lapValid = false;

    // 구간 경계 통과
    if (this.lapStartT !== null && this.geom.sectorBounds && this.prev && this.prev.s !== null && tr.s !== null) {
      const a = this.prev.s;
      const b = tr.s;
      if (b > a && b - a < 50) {
        this.geom.sectorBounds.forEach((bound, i) => {
          if (this.sectorCross[i] === null && a < bound && b >= bound) {
            this.sectorCross[i] = this.prev!.t + ((bound - a) / (b - a)) * (p.t - this.prev!.t);
          }
        });
      }
    }
    this.prev = { t: p.t, s: tr.s };

    // 델타: 10 Hz
    if (p.t - this.lastDeltaT >= 1000 / config.delta.updateHz) {
      this.lastDeltaT = p.t;
      const ok =
        this.ref !== null &&
        tr.s !== null &&
        this.lapStartT !== null &&
        tr.onCourse &&
        p.gpsOk &&
        p.sigmaPos <= config.delta.sLowConfidenceSigmaM;
      const raw = ok ? rawDelta(p.t - this.lapStartT!, tr.s!, this.ref!.trace, this.ref!.lapTimeMs, this.geom.centerline?.length) : null;
      this.delta = this.filter.push(p.t, raw);
    }

    return this.state(p, g, tr.s, tr.onCourse, status, this.lapStartT === null ? null : p.t - this.lapStartT);
  }

  private startLap(t: number): void {
    this.lapNo += 1;
    this.lapStartT = t;
    this.lapValid = true;
    this.sectorCross = [null, null];
    this.filter.push(t, null);
    this.delta = null;
    this.st?.resetAtStart();
    if (this.prev) this.prev = { t: this.prev.t, s: null };
  }

  private completeLap(t: number): void {
    const timeMs = t - this.lapStartT!;
    const [s1, s2] = this.sectorCross;
    const sectors: [number | null, number | null, number | null] = [
      s1 !== null ? s1 - this.lapStartT! : null,
      s1 !== null && s2 !== null ? s2 - s1 : null,
      s2 !== null ? t - s2 : null,
    ];
    this.lastLap = { lapNo: this.lapNo, timeMs, t, valid: this.lapValid, sectorTimesMs: sectors };
    if (this.lapValid && (this.bestLapMs === null || timeMs < this.bestLapMs)) this.bestLapMs = timeMs;
  }

  private state(
    p: LiveInput,
    g: { gx: number; gy: number } | null,
    s: number | null,
    onCourse: boolean,
    status: LiveState['status'],
    lapElapsedMs: number | null,
  ): LiveState {
    const [s1, s2] = this.sectorCross;
    const start = this.lapStartT;
    return {
      t: p.t,
      speedKmh: p.v * 3.6,
      lapNo: this.lapNo,
      lapElapsedMs,
      lastLap: this.lastLap,
      bestLapMs: this.bestLapMs,
      sectorTimesMs: [
        start !== null && s1 !== null ? s1 - start : null,
        s1 !== null && s2 !== null ? s2 - s1 : null,
        null,
      ],
      delta: this.delta,
      s,
      onCourse,
      gx: g ? g.gx : null,
      gy: g ? g.gy : null,
      status,
    };
  }
}
