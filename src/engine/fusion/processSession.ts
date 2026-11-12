// 주행 후 처리 (사양서 5.4-1, 7.2-6, 7.3): 폰 원본 전체로
// 재샘플링 → 거치 보정(세션 전체) → 축 부호 판별·수정 → EKF(기록) → RTS 스무더.
import { config } from '../config';
import type { LatLon } from '../geo';
import { calibrateSession, platformSigns, type CalEvent, type CalSegment } from '../../normalize/mount';
import { resampleMotion, type AxisSigns } from '../../normalize/resample';
import type { GpsSample, RawMotionSample } from '../../types/samples';
import { FusionRunner } from './forward';
import { prepareGps } from './gpsObs';
import { bridgeGpsOnlyGaps, filteredTrack, rtsSmooth, type SmoothedTrack } from './smoother';

export type { SmoothedTrack };

export interface SessionProcessResult {
  origin: LatLon;
  /** 스무더 결과 (50 Hz) */
  track: SmoothedTrack;
  /** 앞에서 뒤로 한 번만 필터한 결과 (세션 전체 보정을 쓰므로 주행 중 실시간 값과는 다를 수 있다) */
  filtered: SmoothedTrack;
  calibration: { segments: CalSegment[]; events: CalEvent[] };
  /** 플랫폼 원본 축 부호 (기본값 표를 정하는 데 쓴다) */
  axisSigns: AxisSigns & { confidence: 'high' | 'low' };
  /** GPS 속도를 위치 차이로 계산한 점이 많음 (사양서 6.3) */
  speedQualityLow: boolean;
  /** 모션을 쓰지 못하고 GPS만으로 처리함 ("정확도 낮음") */
  gpsOnly: boolean;
}

export function processSession(input: {
  gps: GpsSample[];
  motion: RawMotionSample[];
  origin?: LatLon;
  /** 플랫폼 기본 부호 (없으면 +1, +1) */
  axisSigns?: AxisSigns;
}): SessionProcessResult {
  const sorted = [...input.gps].sort((a, b) => a.tRecv - b.tRecv);
  if (sorted.length === 0) throw new Error('GPS 기록이 없습니다');
  const origin = input.origin ?? { lat: sorted[0]!.lat, lon: sorted[0]!.lon };
  const obs = prepareGps(sorted, origin);
  const derived = obs.filter((o) => o.speedDerived).length;

  const base: AxisSigns = input.axisSigns ?? { accel: 1, gyro: 1 };
  const m50 = resampleMotion(input.motion, base);
  // 축 부호 보정은 보정 결과(yawSign, latSign)에 들어 있다
  const calibration = calibrateSession(m50, obs);
  const signed = calibration.segments.find((s) => s.cal?.signsConfirmed)?.cal;
  const fix = signed ? platformSigns(signed.yawSign, signed.latSign) : { accel: 1 as const, gyro: 1 as const };
  const signs: AxisSigns = {
    accel: (base.accel * fix.accel) as 1 | -1,
    gyro: (base.gyro * fix.gyro) as 1 | -1,
  };
  const confidence: 'high' | 'low' = signed ? 'high' : 'low';

  const segs = calibration.segments;
  const runner = new FusionRunner({
    m50,
    gps: obs,
    calibrationAt: (t) => segs.find((s) => t >= s.tStart && t <= s.tEnd)?.cal ?? null,
    record: true,
  });
  const tEnd = Math.max(obs[obs.length - 1]!.t, m50.n > 0 ? m50.t0 + (m50.n - 1) * m50.dt : 0);
  runner.runTo(tEnd);
  const history = runner.history()!;

  // GPS가 오래 끊긴 구간 (GPS만 모드일 때 매끄럽게 잇는다)
  const gaps: Array<[number, number]> = [];
  for (let i = 1; i < obs.length; i++) {
    if (obs[i]!.t - obs[i - 1]!.t > config.fusion.noGateAfterGapS * 1000) gaps.push([obs[i - 1]!.t, obs[i]!.t]);
  }

  return {
    origin,
    track: bridgeGpsOnlyGaps(rtsSmooth(history), gaps),
    filtered: filteredTrack(history),
    calibration,
    axisSigns: { ...signs, confidence },
    speedQualityLow: derived / obs.length > config.fusion.speedQualityLowFraction,
    gpsOnly: m50.n === 0 || segs.every((s) => s.cal === null),
  };
}
