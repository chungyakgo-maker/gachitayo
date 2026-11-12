// 정답 주행: 코스를 가속·제동·횡가속도 한계 안에서 가능한 빨리 달린다 (100 Hz).
import type { Track } from './track';

export interface DriveOpts {
  /** 닫힌 코스의 바퀴 수 (편도는 무시) */
  laps: number;
  /** 출발 전 정차 시간 s (거치 보정용) */
  startStopS: number;
  /** 도착 후 정차 시간 s */
  endStopS: number;
  /** 바퀴마다 출발선에서 정차하는 시간 s (0이면 정차 없음) */
  lapStopS?: number;
  vMax: number;
  aLatMax: number;
  aAccel: number;
  aBrake: number;
}

export interface Truth {
  hz: number;
  /** 세션 시계 s */
  t: Float64Array;
  /** 달린 거리 m */
  s: Float64Array;
  x: Float64Array;
  y: Float64Array;
  /** 동쪽 기준 반시계 (펼친 값) */
  psi: Float64Array;
  v: Float64Array;
  /** 앞 방향 가속도 */
  aLong: Float64Array;
  /** 왼쪽 가속도 */
  aLat: Float64Array;
  /** 좌회전 + */
  yawRate: Float64Array;
}

const DS = 0.25;
const HZ = 100;

export function simulateDrive(track: Track, opts: DriveOpts): Truth {
  const total = track.closed ? opts.laps * track.length : track.length;
  const n = Math.round(total / DS);
  const ds = total / n;
  const isStop = new Uint8Array(n + 1);
  isStop[0] = 1;
  isStop[n] = 1;
  if (track.closed && opts.lapStopS) {
    for (let lap = 1; lap < opts.laps; lap++) isStop[Math.round((lap * track.length) / ds)] = 1;
  }

  // 속도 프로필 (거리 기준): 코너 한계 → 앞으로 가속 한계 → 뒤로 제동 한계
  const v = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const k = Math.abs(track.pointAt(i * ds).curvature);
    v[i] = isStop[i] ? 0 : Math.min(opts.vMax, k > 1e-9 ? Math.sqrt(opts.aLatMax / k) : opts.vMax);
  }
  for (let i = 0; i < n; i++) v[i + 1] = Math.min(v[i + 1]!, Math.sqrt(v[i]! ** 2 + 2 * opts.aAccel * ds));
  for (let i = n; i > 0; i--) v[i - 1] = Math.min(v[i - 1]!, Math.sqrt(v[i]! ** 2 + 2 * opts.aBrake * ds));

  // 구간마다 등가속 운동. 정차 지점에서는 머무는 시간을 넣는다.
  type Node = { t: number; s: number; v: number; a: number };
  const nodes: Node[] = [];
  let t = opts.startStopS;
  nodes.push({ t: 0, s: 0, v: 0, a: 0 });
  for (let i = 0; i < n; i++) {
    if (i > 0 && isStop[i] && opts.lapStopS) {
      nodes.push({ t, s: i * ds, v: 0, a: 0 });
      t += opts.lapStopS;
    }
    const a = (v[i + 1]! ** 2 - v[i]! ** 2) / (2 * ds);
    nodes.push({ t, s: i * ds, v: v[i]!, a });
    t += (2 * ds) / (v[i]! + v[i + 1]!);
  }
  nodes.push({ t, s: total, v: 0, a: 0 });
  const tEnd = t + opts.endStopS;

  const m = Math.floor(tEnd * HZ) + 1;
  const out: Truth = {
    hz: HZ,
    t: new Float64Array(m),
    s: new Float64Array(m),
    x: new Float64Array(m),
    y: new Float64Array(m),
    psi: new Float64Array(m),
    v: new Float64Array(m),
    aLong: new Float64Array(m),
    aLat: new Float64Array(m),
    yawRate: new Float64Array(m),
  };
  let j = 0;
  for (let q = 0; q < m; q++) {
    const tq = q / HZ;
    while (j < nodes.length - 1 && nodes[j + 1]!.t <= tq) j++;
    const nd = nodes[j]!;
    let sq: number;
    let vq: number;
    let aq: number;
    if (j === nodes.length - 1 || tq < opts.startStopS) {
      sq = nd.s;
      vq = 0;
      aq = 0;
    } else {
      const dt = tq - nd.t;
      sq = Math.min(nd.s + nd.v * dt + 0.5 * nd.a * dt * dt, nodes[j + 1]!.s);
      vq = Math.max(0, nd.v + nd.a * dt);
      aq = nd.a;
    }
    const p = track.pointAt(sq);
    out.t[q] = tq;
    out.s[q] = sq;
    out.x[q] = p.x;
    out.y[q] = p.y;
    out.psi[q] = p.psi;
    out.v[q] = vq;
    out.aLong[q] = aq;
    out.aLat[q] = vq * vq * p.curvature;
    out.yawRate[q] = vq * p.curvature;
  }
  return out;
}

/** 임의 시각(s)의 정답 (선형 보간) */
export function truthAt(truth: Truth, tSec: number) {
  const f = Math.min(Math.max(tSec * truth.hz, 0), truth.t.length - 1);
  const i = Math.min(Math.floor(f), truth.t.length - 2);
  const w = f - i;
  const at = (a: Float64Array) => a[i]! + (a[i + 1]! - a[i]!) * w;
  return {
    t: tSec,
    s: at(truth.s),
    x: at(truth.x),
    y: at(truth.y),
    psi: at(truth.psi),
    v: at(truth.v),
    aLong: at(truth.aLong),
    aLat: at(truth.aLat),
    yawRate: at(truth.yawRate),
  };
}
