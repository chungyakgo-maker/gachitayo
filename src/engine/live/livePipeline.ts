// 주행 중 계산 묶음 (사양서 5.3): 센서 원본 → 공통 기준(50 Hz, 평면 좌표) → 거치 보정 → 융합(실시간 필터)
// → 코스 엔진·델타 엔진 → 주행 화면 스냅숏.
// 기록기와 같은 샘플을 받는다. 화면은 tick(지금 시각)을 100 ms마다 불러 스냅숏을 그린다.
import { fromLocal, toLocal, type LatLon } from '../geo';
import { buildGeometry, type CourseGeometry } from '../course/geometry';
import { polylinePoint } from '../course/polyline';
import { refDistanceAt } from '../delta/trace';
import { FusionRunner, type FusedPoint } from '../fusion/forward';
import { LiveGpsObs, type GpsObs } from '../fusion/gpsObs';
import { GpsReadiness } from '../fusion/gpsReady';
import { LiveMotion50 } from '../../normalize/liveMotion';
import { MountCalibrator, toCar, type CalState } from '../../normalize/mount';
import type { AxisSigns } from '../../normalize/resample';
import type { Course } from '../../types/course';
import type { GpsSample, RawMotionSample } from '../../types/samples';
import { LiveEngine, type LiveRef, type LiveState } from './liveEngine';

export interface LivePipelineOpts {
  course: Course | null;
  ref: LiveRef | null;
  /** 플랫폼 기본 축 부호 (없으면 +1, +1. 주행 중 확인으로 바로잡는다) */
  axisSigns?: AxisSigns;
}

export interface LiveSnapshot {
  /** 세션 시계 ms */
  t: number;
  /** 첫 융합 위치가 나오기 전이면 null */
  state: LiveState | null;
  /** 좌표계: course = 코스 원점 기준(코스 중심선과 같은 평면), session = 첫 GPS 기준 */
  frame: 'course' | 'session';
  pos: { x: number; y: number; psi: number } | null;
  gps: { ready: boolean; hAcc: number | null; ageMs: number | null };
  calibration: {
    state: CalState;
    /** 거치 보정의 3초 정차 진행률 0~1 (위 방향을 구했으면 1) */
    stillProgress: number;
    /** 앞 방향·축 부호까지 확인됨 (G값 표시 가능) */
    signsConfirmed: boolean;
    /** 모션 값이 들어오고 있는지 */
    motionActive: boolean;
  };
  /** 베스트 고스트: 비교 랩이 지금과 같은 랩 경과 시간에 있던 곳 */
  ghost: { x: number; y: number; s: number } | null;
  /** 지나온 경로 (같은 좌표계, 3 m 간격) */
  path: ReadonlyArray<readonly [number, number]>;
}

const STEP_MS = 20;
/** 모션이 이만큼 넘게 늦으면(권한 없음, 멈춤) GPS만으로 진행한다 */
const MOTION_STALE_MS = 500;
/** GPS가 이보다 오래되거나 오차가 이보다 크면 "GPS 약함" */
const GPS_OK_AGE_MS = 2500;
const GPS_OK_HACC_M = 25;
const STILL_SPEED_MPS = 0.5;
const STILL_NEEDED_MS = 3000;
const PATH_STEP_M = 3;
const PATH_MAX = 6000;

export class LivePipeline {
  private fusionOrigin: LatLon | null;
  private gpsObs: LiveGpsObs | null = null;
  private readonly motion: LiveMotion50;
  private readonly cal: MountCalibrator;
  private runner: FusionRunner | null = null;
  private engine!: LiveEngine;
  private geom: CourseGeometry | null = null;
  private ref: LiveRef | null = null;
  private readonly readiness = new GpsReadiness();
  private readonly gpsQueue: GpsObs[] = [];
  private gq = 0;
  private calDone = 0;
  private stepT: number | null = null;
  private lastGps: GpsSample | null = null;
  private stillSince: number | null = null;
  private state: LiveState | null = null;
  private pos: LiveSnapshot['pos'] = null;
  private path: Array<[number, number]> = [];

  constructor(opts: LivePipelineOpts) {
    this.motion = new LiveMotion50(opts.axisSigns);
    this.cal = new MountCalibrator(this.motion);
    this.fusionOrigin = opts.course?.origin ?? null;
    this.setCourse(opts.course, opts.ref);
  }

  /** 주행 준비에서 코스·비교 랩을 바꾸면 코스 엔진만 새로 만든다 (융합과 보정은 이어진다) */
  setCourse(course: Course | null, ref: LiveRef | null): void {
    const oldOrigin = this.displayOrigin();
    this.geom = course ? buildGeometry(course) : null;
    this.ref = ref;
    this.engine = new LiveEngine(this.geom, ref);
    this.state = null;
    const newOrigin = this.displayOrigin();
    if (oldOrigin && newOrigin && !sameOrigin(oldOrigin, newOrigin)) {
      this.path = this.path.map(([x, y]) => {
        const ll = fromLocal(oldOrigin, x, y);
        const p = toLocal(newOrigin, ll.lat, ll.lon);
        return [p.x, p.y];
      });
    }
  }

  pushGps(g: GpsSample): void {
    if (!this.fusionOrigin) this.fusionOrigin = { lat: g.lat, lon: g.lon };
    this.gpsObs ??= new LiveGpsObs(this.fusionOrigin);
    this.readiness.push(g);
    this.lastGps = g;
    const o = this.gpsObs.push(g);
    this.gpsQueue.push(o);
    this.runner ??= new FusionRunner({ m50: this.motion, calibrationAt: () => this.cal.current });
    this.runner.pushGps(o);
    if (o.speed !== null && o.speed < STILL_SPEED_MPS) this.stillSince ??= o.t;
    else this.stillSince = null;
  }

  pushMotion(m: RawMotionSample): void {
    this.motion.push(m);
  }

  tick(tNow: number): LiveSnapshot {
    const m = this.motion;
    // 1. 거치 보정: 들어온 모션 격자까지, GPS는 시각 순서대로 끼워 넣는다
    for (; this.calDone < m.n; this.calDone++) {
      const t = m.t0 + this.calDone * m.dt;
      while (this.gq < this.gpsQueue.length && this.gpsQueue[this.gq]!.t <= t) this.cal.pushGps(this.gpsQueue[this.gq++]!);
      this.cal.pushMotion(this.calDone);
    }
    const motionEnd = m.n > 0 ? m.t0 + (m.n - 1) * m.dt : null;
    const motionActive = motionEnd !== null && tNow - motionEnd < MOTION_STALE_MS;
    if (!motionActive) while (this.gq < this.gpsQueue.length) this.cal.pushGps(this.gpsQueue[this.gq++]!);
    this.gpsQueue.splice(0, this.gq);
    this.gq = 0;

    // 2. 융합: 모션이 들어오는 동안은 모션이 있는 시각까지만 (없는 칸을 GPS만으로 메우지 않게)
    const target = motionActive ? Math.min(tNow, motionEnd!) : tNow;
    if (this.runner) {
      if (this.stepT === null) {
        this.runner.runTo(target);
        const p = this.runner.current();
        if (p) {
          this.stepT = p.t;
          this.feed(p);
        }
      }
      while (this.stepT !== null && this.stepT + STEP_MS <= target) {
        this.runner.runTo(this.stepT + STEP_MS);
        const p = this.runner.current()!;
        this.stepT = p.t;
        this.feed(p);
      }
    }

    // 3. 스냅숏
    const cal = this.cal.current;
    const stillProgress =
      this.cal.state !== 'need_stationary' ? 1 : this.stillSince === null ? 0 : Math.min(1, (tNow - this.stillSince) / STILL_NEEDED_MS);
    return {
      t: tNow,
      state: this.state,
      frame: this.geom ? 'course' : 'session',
      pos: this.pos,
      gps: {
        ready: this.readiness.ready,
        hAcc: this.lastGps?.hAcc ?? null,
        ageMs: this.lastGps ? Math.max(0, tNow - this.lastGps.tRecv) : null,
      },
      calibration: { state: this.cal.state, stillProgress, signsConfirmed: cal?.signsConfirmed ?? false, motionActive },
      ghost: this.ghost(),
      path: this.path,
    };
  }

  private feed(p: FusedPoint): void {
    const d = this.toDisplay(p.x, p.y);
    const m = this.motion;
    const cal = this.cal.current;
    let ax: number | null = null;
    let ay: number | null = null;
    const i = Math.round((p.t - m.t0) / m.dt);
    if (cal?.signsConfirmed && i >= 0 && i < m.n && m.valid[i]) {
      const c = toCar(cal, [m.fx[i]!, m.fy[i]!, m.fz[i]!], [m.wx[i]!, m.wy[i]!, m.wz[i]!]);
      ax = c.ax;
      ay = c.ay;
    }
    const g = this.lastGps;
    const gpsOk = g !== null && p.t - g.tRecv <= GPS_OK_AGE_MS && g.hAcc <= GPS_OK_HACC_M;
    this.state = this.engine.push({
      t: p.t,
      x: d.x,
      y: d.y,
      v: Math.max(0, p.v),
      sigmaPos: p.sigmaPos,
      ax,
      ay,
      gpsOk,
      gCalibrated: cal?.signsConfirmed ?? false,
    });
    this.pos = { x: d.x, y: d.y, psi: p.psi };
    const last = this.path[this.path.length - 1];
    if (!last || Math.hypot(d.x - last[0], d.y - last[1]) >= PATH_STEP_M) {
      this.path.push([d.x, d.y]);
      if (this.path.length > PATH_MAX) this.path.splice(0, this.path.length - PATH_MAX);
    }
  }

  private ghost(): LiveSnapshot['ghost'] {
    const st = this.state;
    const cl = this.geom?.centerline;
    if (!st || !cl || !this.ref || st.lapElapsedMs === null || st.lapNo === 0) return null;
    const s = refDistanceAt(this.ref.trace, st.lapElapsedMs / 1000, this.ref.lapTimeMs, cl.length);
    const q = polylinePoint(cl, s);
    return { x: q.x, y: q.y, s };
  }

  private displayOrigin(): LatLon | null {
    return this.geom?.course.origin ?? this.fusionOrigin;
  }

  /** 융합 평면(첫 GPS 또는 처음 코스 원점) → 화면 평면(지금 코스 원점) */
  private toDisplay(x: number, y: number): { x: number; y: number } {
    const from = this.fusionOrigin!;
    const to = this.displayOrigin()!;
    if (sameOrigin(from, to)) return { x, y };
    const ll = fromLocal(from, x, y);
    return toLocal(to, ll.lat, ll.lon);
  }
}

const sameOrigin = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon;
