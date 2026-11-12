// 주행 중 50 Hz 재샘플링 (사양서 6.3, 5.3): 모션 원본이 들어올 때마다 격자를 채우는 늘어나는 Motion50.
// 같은 원본이면 resampleMotion(일괄)과 같은 값이 나온다. 격자 점은 그 뒤 샘플이 들어와야 채워진다(약 20 ms 늦음).
import { config } from '../engine/config';
import type { RawMotionSample } from '../types/samples';
import type { AxisSigns, Motion50 } from './resample';

const INITIAL_CAPACITY = 4096;

export class LiveMotion50 implements Motion50 {
  t0 = 0;
  readonly dt = 1000 / config.motion.resampleHz;
  n = 0;
  fx = new Float64Array(INITIAL_CAPACITY);
  fy = new Float64Array(INITIAL_CAPACITY);
  fz = new Float64Array(INITIAL_CAPACITY);
  wx = new Float64Array(INITIAL_CAPACITY);
  wy = new Float64Array(INITIAL_CAPACITY);
  wz = new Float64Array(INITIAL_CAPACITY);
  valid = new Uint8Array(INITIAL_CAPACITY);
  gyroValid = new Uint8Array(INITIAL_CAPACITY);
  hasGyro = false;

  private prev: RawMotionSample | null = null;
  private count = 0;
  private gyroCount = 0;

  constructor(private readonly signs: AxisSigns = { accel: 1, gyro: 1 }) {}

  /** 원본 샘플 하나 (시간 순서. 앞선 시각의 샘플은 버린다) */
  push(b: RawMotionSample): void {
    const a = this.prev;
    if (a && b.t < a.t) return;
    this.count += 1;
    if (gyroOk(b)) this.gyroCount += 1;
    this.hasGyro = this.gyroCount >= this.count / 2;
    this.prev = b;
    if (!a) {
      this.t0 = Math.ceil(b.t / this.dt) * this.dt;
      return;
    }
    // 아직 채우지 않은 격자 중 b 시각까지
    const last = Math.floor((b.t - this.t0) / this.dt);
    if (last < this.n) return;
    this.ensure(last + 1);
    const sa = this.signs.accel;
    const sg = this.signs.gyro;
    const gap = b.t - a.t > config.motion.maxGapMs;
    for (let i = this.n; i <= last; i++) {
      const t = this.t0 + i * this.dt;
      if (gap || t < a.t || t > b.t) {
        this.valid[i] = 0;
        this.gyroValid[i] = 0;
        this.fx[i] = this.fy[i] = this.fz[i] = this.wx[i] = this.wy[i] = this.wz[i] = 0;
        continue;
      }
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      const lerp = (p: number, q: number) => p + (q - p) * f;
      this.fx[i] = sa * lerp(a.gax, b.gax);
      this.fy[i] = sa * lerp(a.gay, b.gay);
      this.fz[i] = sa * lerp(a.gaz, b.gaz);
      if (gyroOk(a) && gyroOk(b)) {
        this.wx[i] = sg * lerp(a.rx!, b.rx!);
        this.wy[i] = sg * lerp(a.ry!, b.ry!);
        this.wz[i] = sg * lerp(a.rz!, b.rz!);
        this.gyroValid[i] = 1;
      } else {
        this.wx[i] = this.wy[i] = this.wz[i] = 0;
        this.gyroValid[i] = 0;
      }
      this.valid[i] = 1;
    }
    this.n = last + 1;
  }

  private ensure(size: number): void {
    if (size <= this.fx.length) return;
    let cap = this.fx.length;
    while (cap < size) cap *= 2;
    const grow64 = (a: Float64Array) => {
      const b = new Float64Array(cap);
      b.set(a.subarray(0, this.n));
      return b;
    };
    const grow8 = (a: Uint8Array) => {
      const b = new Uint8Array(cap);
      b.set(a.subarray(0, this.n));
      return b;
    };
    this.fx = grow64(this.fx);
    this.fy = grow64(this.fy);
    this.fz = grow64(this.fz);
    this.wx = grow64(this.wx);
    this.wy = grow64(this.wy);
    this.wz = grow64(this.wz);
    this.valid = grow8(this.valid);
    this.gyroValid = grow8(this.gyroValid);
  }
}

const gyroOk = (m: RawMotionSample) => m.rx !== null && m.ry !== null && m.rz !== null;
