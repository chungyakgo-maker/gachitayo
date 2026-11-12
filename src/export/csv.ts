// CSV 내보내기 (사양서 6.9): 영상 오버레이 프로그램(Telemetry Overlay의 Custom CSV, RaceRender 등)이 바로 읽는 형식.
// 처리된 궤적(10 Hz) 한 행에 한 시점. 열 순서와 이름은 바꾸지 않고, 채널(13.2 OBD)은 뒤에 덧붙인다.
// 순수 TS (브라우저 기능을 쓰지 않는다, 사양서 5.1·13.3).
import { rawDelta } from '../engine/delta/delta';
import type { LapTrace } from '../engine/delta/trace';
import type { LapResult } from '../engine/course/laps';
import type { ProcessedTrack } from '../engine/process/processDrive';

export const CSV_COLUMNS = [
  'utc_time',
  'elapsed_s',
  'lap',
  'lap_time_s',
  'sector',
  'distance_m',
  'lat',
  'lon',
  'alt_m',
  'speed_kmh',
  'heading_deg',
  'g_lat',
  'g_long',
  'delta_s',
  'lap_valid',
  'gps_acc_m',
] as const;

const G = 9.80665;

export interface SessionCsvInput {
  processed: ProcessedTrack;
  /** 처리된 궤적에 utc 열이 없을 때(M7 전 결과) 기준 */
  startedAtEpochMs: number;
  laps: Pick<LapResult, 'lapNo' | 'startT' | 'endT' | 'valid'>[];
  /** 코스 구간 경계 [1|2, 2|3] (m) */
  sectorBoundsM: readonly [number, number] | null;
  lengthM: number | null;
  /** 비교 랩. 없으면 delta_s는 빈칸 */
  ref: { trace: LapTrace; lapTimeMs: number } | null;
  /** 고른 랩만 (앞뒤 여유 초). 없으면 세션 전체 */
  range?: { laps: number[]; paddingS?: number } | null;
  /** 덧붙일 채널 (13.2): 이름 → 세션 시계 ms와 값. 그 시각 직전 값을 쓴다 */
  channels?: Record<string, { t: number[]; v: number[] }>;
}

const fx = (v: number | null | undefined, d: number) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(d));

/** 세션(또는 고른 랩) CSV */
export function sessionCsv(input: SessionCsvInput): string {
  const p = input.processed;
  const lapByNo = new Map(input.laps.map((l) => [l.lapNo, l]));
  const ranges = input.range
    ? input.range.laps
        .map((n) => lapByNo.get(n))
        .filter((l): l is NonNullable<typeof l> => !!l)
        .map((l) => [l.startT - (input.range!.paddingS ?? 0) * 1000, l.endT + (input.range!.paddingS ?? 0) * 1000] as const)
    : null;
  const channelNames = Object.keys(input.channels ?? {});
  const chCursor = channelNames.map(() => 0);
  const lines: string[] = [[...CSV_COLUMNS, ...channelNames].join(',')];
  const [b1, b2] = input.sectorBoundsM ?? [null, null];

  for (let k = 0; k < p.n; k++) {
    const t = p.t[k]!;
    if (ranges && !ranges.some(([a, b]) => t >= a && t <= b)) continue;
    const lapNo = p.lapNo[k] ?? 0;
    const lap = lapNo > 0 ? lapByNo.get(lapNo) : undefined;
    const s = p.s[k] ?? null;
    const lapMs = lap ? t - lap.startT : null;
    const sector = lap && s !== null && b1 !== null && b2 !== null ? (s < b1 ? 1 : s < b2 ? 2 : 3) : null;
    const delta = input.ref && lapMs !== null && s !== null ? rawDelta(lapMs, s, input.ref.trace, input.ref.lapTimeMs, input.lengthM ?? undefined) : null;
    const utc = p.utc?.[k] ?? input.startedAtEpochMs + t;
    const ax = p.ax[k];
    const ay = p.ay[k];
    const row = [
      new Date(Math.round(utc)).toISOString(),
      fx(t / 1000, 3),
      String(lapNo),
      fx(lapMs === null ? null : lapMs / 1000, 3),
      sector === null ? '' : String(sector),
      fx(s, 2),
      fx(p.lat[k], 7),
      fx(p.lon[k], 7),
      fx(p.alt[k], 1),
      fx(p.speed[k]! * 3.6, 1),
      fx(p.heading[k], 1),
      fx(ay === null || ay === undefined ? null : ay / G, 3),
      fx(ax === null || ax === undefined ? null : ax / G, 3),
      fx(delta, 3),
      lap ? (lap.valid ? '1' : '0') : '0',
      fx(p.hAcc?.[k], 1),
    ];
    channelNames.forEach((name, i) => {
      const ch = input.channels![name]!;
      let c = chCursor[i]!;
      while (c + 1 < ch.t.length && ch.t[c + 1]! <= t) c++;
      chCursor[i] = c;
      row.push(ch.t.length && ch.t[c]! <= t ? String(Math.round(ch.v[c]! * 100) / 100) : '');
    });
    lines.push(row.join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** 랩 요약 CSV: lap, lap_time_s, s1_s, s2_s, s3_s, valid, invalid_reason */
export function lapsCsv(laps: Pick<LapResult, 'lapNo' | 'lapTimeMs' | 'sectorTimesMs' | 'valid' | 'invalidReason'>[]): string {
  const lines = ['lap,lap_time_s,s1_s,s2_s,s3_s,valid,invalid_reason'];
  for (const l of laps) {
    const sec = l.sectorTimesMs.map((v) => fx(v === null ? null : v / 1000, 3));
    lines.push([String(l.lapNo), fx(l.lapTimeMs / 1000, 3), ...sec, l.valid ? '1' : '0', l.invalidReason ?? ''].join(','));
  }
  return `${lines.join('\n')}\n`;
}

const KST_OFFSET_MS = 9 * 3_600_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** gachitayo_{코스이름}_{YYYYMMDD-HHmm}.csv (시각은 KST). kind 'laps'면 …_laps.csv */
export function csvFileName(courseName: string | null, startedAtEpochMs: number, kind: 'session' | 'laps' = 'session'): string {
  const d = new Date(startedAtEpochMs + KST_OFFSET_MS);
  const stamp = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;
  const name = (courseName?.trim() || '코스없음').replace(/[\\/:*?"<>|\s]+/g, '_');
  return `gachitayo_${name}_${stamp}${kind === 'laps' ? '_laps' : ''}.csv`;
}
