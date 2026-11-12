// 원본 파일 (사양서 6.7): 열 단위 배열 JSON, gzip은 gzip.ts에서.
// 기기 축 원본을 그대로 담아, 주행 후에 보정과 계산을 다시 할 수 있게 한다.
import type { GpsSample, RawMotionSample, SessionEvent } from '../types/samples';
import type { Channels, ChunkRecord, DeviceInfo, SessionRecord } from '../types/session';

export interface RawFileV1 {
  formatVersion: 1;
  sessionId: string;
  startedAtEpochMs: number;
  device: DeviceInfo;
  calibration: null;
  gps: {
    tRecv: number[];
    tFix: number[];
    lat: number[];
    lon: number[];
    alt: (number | null)[];
    altAcc: (number | null)[];
    hAcc: number[];
    speed: (number | null)[];
    heading: (number | null)[];
  };
  motion: {
    t: number[];
    gax: number[];
    gay: number[];
    gaz: number[];
    rx: (number | null)[];
    ry: (number | null)[];
    rz: (number | null)[];
  };
  events: SessionEvent[];
  /** 추가 센서 채널 (사양서 13.2 확장 지점). 1단계에서는 {}. 예전 파일에는 없다 */
  channels?: Channels;
}

/** 소수 d자리 반올림. 1.005 → 1.01처럼 십진수 기준으로 맞추기 위해 지수 표기를 쓴다. */
export function roundTo(v: number, d: number): number {
  const s = String(v);
  const r = s.includes('e')
    ? Math.round(v * 10 ** d) / 10 ** d
    : Number(`${Math.round(Number(`${s}e${d}`))}e-${d}`);
  return r === 0 ? 0 : r; // -0 없애기
}

const r2 = (v: number) => roundTo(v, 2);
const r3 = (v: number) => roundTo(v, 3);
const r7 = (v: number) => roundTo(v, 7);
const orNull = (f: (v: number) => number) => (v: number | null) => (v === null ? null : f(v));

export function buildRawFile(session: SessionRecord, chunks: ChunkRecord[]): RawFileV1 {
  const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
  const gps = sorted.flatMap((c) => c.gps);
  const motion = sorted.flatMap((c) => c.rawMotion);
  const events = sorted.flatMap((c) => c.events);
  return {
    formatVersion: 1,
    sessionId: session.id,
    startedAtEpochMs: session.startedAt,
    device: session.device,
    calibration: session.calibration,
    gps: {
      tRecv: gps.map((g) => r2(g.tRecv)),
      tFix: gps.map((g) => r2(g.tFix)),
      lat: gps.map((g) => r7(g.lat)),
      lon: gps.map((g) => r7(g.lon)),
      alt: gps.map((g) => orNull(r2)(g.alt)),
      altAcc: gps.map((g) => orNull(r2)(g.altAcc)),
      hAcc: gps.map((g) => r2(g.hAcc)),
      speed: gps.map((g) => orNull(r2)(g.speed)),
      heading: gps.map((g) => orNull(r2)(g.heading)),
    },
    motion: {
      t: motion.map((m) => r2(m.t)),
      gax: motion.map((m) => r3(m.gax)),
      gay: motion.map((m) => r3(m.gay)),
      gaz: motion.map((m) => r3(m.gaz)),
      rx: motion.map((m) => orNull(r3)(m.rx)),
      ry: motion.map((m) => orNull(r3)(m.ry)),
      rz: motion.map((m) => orNull(r3)(m.rz)),
    },
    events: events.map((e) => ({ ...e, t: r2(e.t) })),
    channels: mergeChannels(sorted),
  };
}

/** 덩어리들의 채널을 이름별로 seq 순서대로 이어 붙인다 (시각 소수 2자리, 값 소수 2자리) */
function mergeChannels(sorted: ChunkRecord[]): Channels {
  const out: Channels = {};
  for (const c of sorted) {
    for (const [name, series] of Object.entries(c.channels ?? {})) {
      const o = (out[name] ??= { t: [], v: [] });
      o.t.push(...series.t.map(r2));
      o.v.push(...series.v.map(r2));
    }
  }
  return out;
}

/** 원본 파일 → 샘플 배열 */
export function readRawFile(value: unknown): {
  file: RawFileV1;
  gps: GpsSample[];
  motion: RawMotionSample[];
  events: SessionEvent[];
  channels: Channels;
} {
  const f = value as RawFileV1;
  if (!f || f.formatVersion !== 1) {
    throw new Error('지원하지 않는 원본 파일 형식입니다');
  }
  const g = f.gps;
  const m = f.motion;
  return {
    file: f,
    gps: g.tRecv.map((_, i) => ({
      tRecv: g.tRecv[i]!,
      tFix: g.tFix[i]!,
      lat: g.lat[i]!,
      lon: g.lon[i]!,
      alt: g.alt[i] ?? null,
      altAcc: g.altAcc[i] ?? null,
      hAcc: g.hAcc[i]!,
      speed: g.speed[i] ?? null,
      heading: g.heading[i] ?? null,
    })),
    motion: m.t.map((_, i) => ({
      t: m.t[i]!,
      gax: m.gax[i]!,
      gay: m.gay[i]!,
      gaz: m.gaz[i]!,
      rx: m.rx[i] ?? null,
      ry: m.ry[i] ?? null,
      rz: m.rz[i] ?? null,
    })),
    events: f.events,
    channels: f.channels ?? {},
  };
}
