// 정답 주행에서 폰 센서 원본을 만든다: 1 Hz GPS, 약 60 Hz 기기 축 모션 (M2 원본과 같은 형식).
import { fromLocal, type LatLon } from '../engine/geo';
import { matVec, rotationFromEuler, transpose, type Mat3, type Vec3 } from '../engine/linalg';
import type { GpsSample, RawMotionSample } from '../types/samples';
import { truthAt, type Truth } from './drive';
import { gaussian, mulberry32 } from './random';

export interface SensorOpts {
  seed: number;
  startedAtEpochMs: number;
  origin: LatLon;
  /** GPS 매번 독립 잡음 (축당 표준편차 m) */
  gpsNoiseM: number;
  /** GPS 천천히 흐르는 오차 (축당 표준편차 m) */
  gpsDriftM: number;
  gpsDriftTauS: number;
  /** 튀는 점 비율 */
  outlierRate: number;
  /** GPS 끊김 [시작 s, 끝 s] */
  dropouts: Array<[number, number]>;
  speedNull: boolean;
  headingNull: boolean;
  /** 측정 시각부터 수신까지 지연 */
  gpsLatencyMs: number;
  speedNoise: number;
  headingNoiseDeg: number;
  /** 거치 각도 [요, 피치, 롤] 도 */
  mountEulerDeg: [number, number, number];
  /** 주행 중 거치가 바뀌는 시각과 새 각도 */
  mountChanges: Array<{ atS: number; eulerDeg: [number, number, number] }>;
  /** 플랫폼 부호 (아이폰 가속도 부호 뒤집힘 흉내: −1) */
  accelSign: 1 | -1;
  gyroSign: 1 | -1;
  accelNoise: number;
  accelBias: Vec3;
  gyroNoise: number;
  gyroBias: Vec3;
  motionHz: number;
  motionJitterMs: number;
  /** 모션이 끊긴 구간 [시작 s, 끝 s] */
  motionGaps: Array<[number, number]>;
  noGyro: boolean;
}

export const defaultSensorOpts: SensorOpts = {
  seed: 1,
  startedAtEpochMs: 1_800_000_000_000,
  origin: { lat: 37.2, lon: 127.1 },
  gpsNoiseM: 3,
  gpsDriftM: 1.5,
  gpsDriftTauS: 30,
  outlierRate: 0.01,
  dropouts: [],
  speedNull: false,
  headingNull: false,
  gpsLatencyMs: 0,
  speedNoise: 0.15,
  headingNoiseDeg: 1.5,
  mountEulerDeg: [20, -70, 5],
  mountChanges: [],
  accelSign: 1,
  gyroSign: 1,
  accelNoise: 0.3,
  accelBias: [0.05, -0.08, 0.1],
  gyroNoise: 0.02,
  gyroBias: [0.005, -0.004, 0.008],
  motionHz: 60,
  motionJitterMs: 3,
  motionGaps: [],
  noGyro: false,
};

export const G = 9.80665;
const DEG = Math.PI / 180;

const eulerToMat = (e: [number, number, number]): Mat3 => rotationFromEuler(e[0] * DEG, e[1] * DEG, e[2] * DEG);

const inRanges = (t: number, ranges: Array<[number, number]>) => ranges.some(([a, b]) => t >= a && t <= b);

export function synthesizeSensors(truth: Truth, opts: SensorOpts) {
  const rng = mulberry32(opts.seed);
  const tEnd = truth.t[truth.t.length - 1]!;
  const gps: GpsSample[] = [];
  const motion: RawMotionSample[] = [];

  // GPS 1 Hz
  const decay = Math.exp(-1 / opts.gpsDriftTauS);
  const driftStep = opts.gpsDriftM * Math.sqrt(1 - decay * decay);
  let dx = gaussian(rng) * opts.gpsDriftM;
  let dy = gaussian(rng) * opts.gpsDriftM;
  const sigmaTotal = Math.hypot(opts.gpsNoiseM, opts.gpsDriftM);
  for (let k = 1; k <= Math.floor(tEnd); k++) {
    dx = dx * decay + gaussian(rng) * driftStep;
    dy = dy * decay + gaussian(rng) * driftStep;
    const tk = k + (rng() - 0.5) * 0.06;
    if (inRanges(tk, opts.dropouts)) continue;
    const tr = truthAt(truth, tk);
    let ex = gaussian(rng) * opts.gpsNoiseM + dx;
    let ey = gaussian(rng) * opts.gpsNoiseM + dy;
    if (rng() < opts.outlierRate) {
      const d = 30 + rng() * 50;
      const th = rng() * 2 * Math.PI;
      ex += d * Math.cos(th);
      ey += d * Math.sin(th);
    }
    const ll = fromLocal(opts.origin, tr.x + ex, tr.y + ey);
    const headingDeg = (((90 - tr.psi / DEG + gaussian(rng) * opts.headingNoiseDeg) % 360) + 360) % 360;
    gps.push({
      tRecv: tk * 1000 + opts.gpsLatencyMs,
      tFix: opts.startedAtEpochMs + Math.round(tk * 1000),
      lat: ll.lat,
      lon: ll.lon,
      alt: 50 + gaussian(rng) * 3,
      altAcc: 8,
      hAcc: Math.max(1, 2 * sigmaTotal * (0.9 + rng() * 0.2)),
      speed: opts.speedNull ? null : Math.max(0, tr.v + gaussian(rng) * opts.speedNoise),
      heading: opts.headingNull || tr.v < 0.5 ? null : headingDeg,
    });
  }

  // 모션 (기기 축, 중력 포함 가속도와 회전 속도 rad/s)
  const mounts = [{ atS: -Infinity, R: eulerToMat(opts.mountEulerDeg) }].concat(
    opts.mountChanges.map((c) => ({ atS: c.atS, R: eulerToMat(c.eulerDeg) })),
  );
  const step = 1000 / opts.motionHz;
  for (let tm = 0; tm <= tEnd * 1000; tm += step + (rng() - 0.5) * 2 * opts.motionJitterMs) {
    const ts = tm / 1000;
    if (inRanges(ts, opts.motionGaps)) continue;
    const tr = truthAt(truth, ts);
    const R = mounts.filter((m) => m.atS <= ts).at(-1)!.R;
    const Rt = transpose(R);
    const fCar: Vec3 = [
      tr.aLong + gaussian(rng) * opts.accelNoise,
      tr.aLat + gaussian(rng) * opts.accelNoise,
      G + gaussian(rng) * opts.accelNoise,
    ];
    const wCar: Vec3 = [
      gaussian(rng) * opts.gyroNoise,
      gaussian(rng) * opts.gyroNoise,
      tr.yawRate + gaussian(rng) * opts.gyroNoise,
    ];
    const f = matVec(Rt, fCar);
    const w = matVec(Rt, wCar);
    motion.push({
      t: tm,
      gax: opts.accelSign * (f[0] + opts.accelBias[0]),
      gay: opts.accelSign * (f[1] + opts.accelBias[1]),
      gaz: opts.accelSign * (f[2] + opts.accelBias[2]),
      rx: opts.noGyro ? null : opts.gyroSign * (w[0] + opts.gyroBias[0]),
      ry: opts.noGyro ? null : opts.gyroSign * (w[1] + opts.gyroBias[1]),
      rz: opts.noGyro ? null : opts.gyroSign * (w[2] + opts.gyroBias[2]),
    });
  }

  return { gps, motion, mount: mounts[0]!.R, mounts, origin: opts.origin, startedAtEpochMs: opts.startedAtEpochMs };
}
