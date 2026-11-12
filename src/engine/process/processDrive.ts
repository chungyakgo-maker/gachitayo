// 주행 후 처리 (사양서 5.4-1~3): 폰 원본 전체 → 융합 스무더 → (코스가 없으면 자동 생성 제안) →
// 게이트·코스 거리·랩·구간·유효 판정 → 비교용 축약 데이터(trace) → 처리된 궤적(10 Hz).
import { config } from '../config';
import { fromLocal, type LatLon } from '../geo';
import { detectCourse } from '../course/autoCourse';
import { centerlineFromPath, startLoopAtGate, withCenterline } from '../course/edit';
import { buildGeometry } from '../course/geometry';
import { splitLaps, theoreticalBest, type FrameTrack, type LapResult } from '../course/laps';
import { buildTrace, type LapTrace } from '../delta/trace';
import { smoothAltitude } from '../derive/altitude';
import { smoothG } from '../derive/gforce';
import { processSession, type SessionProcessResult } from '../fusion/processSession';
import type { Course, CourseKind } from '../../types/course';
import type { GpsSample, RawMotionSample, SessionEvent } from '../../types/samples';

export interface DriveLap extends LapResult {
  trace: LapTrace;
}

/** 처리된 궤적 (사양서 6.7): 10 Hz 열 단위 */
export interface ProcessedTrack {
  hz: number;
  n: number;
  /** 세션 시계 ms */
  t: number[];
  /** GPS 기준 절대 시각 epoch ms (사양서 6.7, 6.9 utc_time, 13.1 영상 싱크). M7 전에 처리해 폰에 저장된 결과에는 없다 */
  utc?: number[];
  lat: number[];
  lon: number[];
  alt: Array<number | null>;
  /** m/s */
  speed: number[];
  /** 나침반 방향 도 */
  heading: number[];
  /** 차 기준 m/s² (0.2초 평균). 보정 전이면 null */
  ax: Array<number | null>;
  ay: Array<number | null>;
  /** 코스 거리 m (모르면 null) */
  s: Array<number | null>;
  /** 랩 번호 (랩 밖이면 0) */
  lapNo: number[];
  /** GPS 수평 정확도 m (그 시각 앞뒤 GPS 점에서 보간, 6.9 gps_acc_m). M7 전 결과에는 없다 */
  hAcc?: number[];
}

export interface DriveResult {
  /** 쓴 코스 (자동으로 만들었거나 중심선을 채웠으면 바뀐 코스). 코스를 정하지 못했으면 null */
  course: Course | null;
  /** 첫 주행이라 코스를 자동으로 만들었다 (주행 종료 때 사용자 확인, 사양서 8.5) */
  courseCreated: boolean;
  /** 지도 등록 코스에 첫 랩으로 중심선을 채웠다 (version +1) */
  courseUpdated: boolean;
  laps: DriveLap[];
  theoreticalBest: { sectorsMs: [number, number, number] | null; totalMs: number | null };
  bestLap: DriveLap | null;
  processed: ProcessedTrack;
  fusion: Pick<SessionProcessResult, 'axisSigns' | 'speedQualityLow' | 'gpsOnly' | 'calibration'>;
}

export interface DriveInput {
  gps: GpsSample[];
  motion: RawMotionSample[];
  events: SessionEvent[];
  course: Course | null;
  /** 코스를 자동으로 만들 때 쓸 id·이름, 사용자가 고른 종류 (주행 종료 확인, 사양서 8.5. 없으면 자동 판정) */
  newCourse?: { id: string; name: string; kind?: CourseKind };
  /** 세션 시작 벽시계 epoch ms. GPS 시각을 믿을 수 없을 때 UTC 열의 기준 */
  startedAtEpochMs?: number;
}

/** 세션 시계 → GPS 기준 절대 시각의 차이 (ms). 융합은 수신 시각 기준이라 tFix − tRecv의 중앙값을 쓴다.
 *  GPS 시각이 세션 시작과 하루 넘게 어긋나면(기기 시계 오류) 세션 시작 시각을 쓴다 */
export function utcOffsetMs(gps: GpsSample[], startedAtEpochMs: number | undefined): number {
  const d = gps.map((g) => g.tFix - g.tRecv).filter(Number.isFinite).sort((a, b) => a - b);
  const median = d.length ? d[Math.floor(d.length / 2)]! : Number.NaN;
  if (startedAtEpochMs === undefined) return Number.isFinite(median) ? median : 0;
  return Number.isFinite(median) && Math.abs(median - startedAtEpochMs) < 86_400_000 ? median : startedAtEpochMs;
}

/** 수신 시각 순으로 정렬된 GPS 점에서 시각 t의 수평 정확도 (선형 보간, 양 끝은 가까운 값) */
function hAccAt(gps: GpsSample[], t: number, from: { i: number }): number {
  let i = from.i;
  while (i + 1 < gps.length && gps[i + 1]!.tRecv <= t) i++;
  from.i = i;
  const a = gps[i]!;
  const b = gps[i + 1];
  if (!b || t <= a.tRecv) return a.hAcc;
  const f = (t - a.tRecv) / (b.tRecv - a.tRecv);
  return a.hAcc + (b.hAcc - a.hAcc) * f;
}

/** 앱이 멈췄던 구간: pause → resume, 또는 강제 종료 뒤 이어서 하기 */
export function pausesFromEvents(events: SessionEvent[], gps: GpsSample[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let lastPause: number | null = null;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.type === 'pause') lastPause = e.t;
    if (e.type !== 'resume') continue;
    if (lastPause !== null) {
      out.push([lastPause, e.t]);
      lastPause = null;
    } else if (e.payload?.afterInterruption) {
      const before = gps.filter((g) => g.tRecv < e.t).reduce((m, g) => Math.max(m, g.tRecv), -Infinity);
      out.push([Number.isFinite(before) ? before : e.t, e.t]);
    }
  }
  return out;
}

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function processDrive(input: DriveInput): DriveResult {
  const gps = [...input.gps].sort((a, b) => a.tRecv - b.tRecv);
  if (gps.length === 0) throw new Error('GPS 기록이 없습니다');
  const origin: LatLon = input.course?.origin ?? { lat: gps[0]!.lat, lon: gps[0]!.lon };
  const fusion = processSession({ gps, motion: input.motion, origin });
  const tr = fusion.track;
  const frames: FrameTrack = {
    n: tr.n,
    t: Float64Array.from({ length: tr.n }, (_, k) => tr.t0 + k * tr.dt),
    x: tr.x,
    y: tr.y,
    v: tr.v,
  };

  const pauses = pausesFromEvents(input.events, gps);
  const gpsTimes = gps.map((g) => g.tRecv);
  // 중심선으로 쓰면 안 되는 구간: 앱 중단, GPS가 5초 넘게 끊긴 곳
  const broken: Array<[number, number]> = [...pauses];
  for (let i = 1; i < gpsTimes.length; i++)
    if (gpsTimes[i]! - gpsTimes[i - 1]! > config.laps.maxGpsGapS * 1000) broken.push([gpsTimes[i - 1]!, gpsTimes[i]!]);

  let course = input.course;
  let courseCreated = false;
  let courseUpdated = false;
  if (!course) {
    const det = detectCourse(tr, origin, { kind: input.newCourse?.kind, exclude: broken });
    if (det) {
      course = withCenterline(
        {
          id: input.newCourse?.id ?? 'new',
          name: input.newCourse?.name ?? '새 코스',
          kind: det.kind,
          source: 'auto',
          origin,
          startGate: det.startGate,
          finishGate: det.finishGate,
          centerline: null,
          lengthM: null,
          sectorBoundsM: null,
          version: 1,
        },
        det.centerline,
      );
      courseCreated = true;
    }
  }

  let split = course ? splitLaps({ geom: buildGeometry(course), track: frames, gpsTimes, pauses }) : null;

  // 지도로 등록한 코스(중심선 없음): 앱 중단·GPS 끊김이 없는 첫 랩 경로로 중심선을 만들고 다시 계산한다 (사양서 7.5 "첫 유효 랩")
  const cleanLap = split?.laps.find((l) => l.invalidReason !== 'interrupted' && l.invalidReason !== 'gps_lost');
  if (course && !course.centerline && split && cleanLap) {
    const l = cleanLap;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 0; k < frames.n; k++) {
      if (frames.t[k]! >= l.startT && frames.t[k]! <= l.endT) {
        xs.push(frames.x[k]!);
        ys.push(frames.y[k]!);
      }
    }
    const loop = course.kind === 'loop';
    let cl = centerlineFromPath(xs, ys, loop);
    if (loop) {
      const g = buildGeometry(course).start;
      cl = startLoopAtGate(cl, g.cx, g.cy);
    }
    course = { ...withCenterline(course, cl), version: course.version + 1 };
    courseUpdated = true;
    split = splitLaps({ geom: buildGeometry(course), track: frames, gpsTimes, pauses });
  }

  const alt = smoothAltitude(gps, frames.t);
  const geom = course ? buildGeometry(course) : null;
  const L = geom?.centerline?.length ?? null;
  const laps: DriveLap[] = (split?.laps ?? []).map((l) => {
    const idx: number[] = [];
    for (let k = 0; k < frames.n; k++) if (frames.t[k]! >= l.startT && frames.t[k]! <= l.endT) idx.push(k);
    const trace =
      L !== null
        ? buildTrace({
            t: idx.map((k) => frames.t[k]!),
            s: idx.map((k) => split!.frameS[k]!),
            v: idx.map((k) => frames.v[k]!),
            alt: alt ? idx.map((k) => alt[k]!) : null,
            startT: l.startT,
            lengthM: L,
          })
        : { stepM: config.delta.stepM, t: [], v: [], alt: [] };
    return { ...l, trace };
  });
  const valid = laps.filter((l) => l.valid);
  const bestLap = valid.length ? valid.reduce((a, b) => (b.lapTimeMs < a.lapTimeMs ? b : a)) : null;

  // 처리된 궤적 10 Hz
  const step = Math.max(1, Math.round(1000 / config.processed.hz / tr.dt));
  const g = smoothG(fusion.carMotion.ax, fusion.carMotion.ay, 1000 / tr.dt);
  const G = config.gforce.g;
  const utc: number[] = [];
  const hAcc: number[] = [];
  const p: ProcessedTrack = { hz: config.processed.hz, n: 0, t: [], utc, lat: [], lon: [], alt: [], speed: [], heading: [], ax: [], ay: [], s: [], lapNo: [], hAcc };
  const utcOffset = utcOffsetMs(gps, input.startedAtEpochMs);
  const accCursor = { i: 0 };
  for (let k = 0; k < tr.n; k += step) {
    const ll = fromLocal(origin, tr.x[k]!, tr.y[k]!);
    const deg = (tr.psi[k]! * 180) / Math.PI;
    const s = split ? split.frameS[k]! : Number.NaN;
    p.t.push(frames.t[k]!);
    utc.push(Math.round(frames.t[k]! + utcOffset));
    p.lat.push(r7(ll.lat));
    p.lon.push(r7(ll.lon));
    p.alt.push(alt ? r2(alt[k]!) : null);
    p.speed.push(r2(tr.v[k]!));
    p.heading.push(r2((((90 - deg) % 360) + 360) % 360));
    p.ax.push(Number.isNaN(g.gx[k]!) ? null : r2(g.gx[k]! * G));
    p.ay.push(Number.isNaN(g.gy[k]!) ? null : r2(g.gy[k]! * G));
    p.s.push(Number.isNaN(s) ? null : r2(s));
    p.lapNo.push(split ? split.frameLap[k]! : 0);
    hAcc.push(Math.round(hAccAt(gps, frames.t[k]!, accCursor) * 10) / 10);
  }
  p.n = p.t.length;

  return {
    course,
    courseCreated,
    courseUpdated,
    laps,
    theoreticalBest: theoreticalBest(laps),
    bestLap,
    processed: p,
    fusion: {
      axisSigns: fusion.axisSigns,
      speedQualityLow: fusion.speedQualityLow,
      gpsOnly: fusion.gpsOnly,
      calibration: fusion.calibration,
    },
  };
}
