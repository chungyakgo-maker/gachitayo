import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, type DriveOpts } from '../generators';
import { processDrive } from '../../src/engine/process/processDrive';
import { CSV_COLUMNS, csvFileName, lapsCsv, sessionCsv } from '../../src/export/csv';

const base: DriveOpts = { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };
const truth = simulateDrive(stadiumTrack(), base);
const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 31 });
const r = processDrive({ gps: s.gps, motion: s.motion, events: [{ t: 0, type: 'start' }], course: null, startedAtEpochMs: s.startedAtEpochMs });
const course = r.course!;
const best = r.bestLap!;
const input = {
  processed: r.processed,
  startedAtEpochMs: s.startedAtEpochMs,
  laps: r.laps,
  sectorBoundsM: course.sectorBoundsM ?? null,
  lengthM: course.lengthM ?? null,
};
const parse = (csv: string) => {
  const [head, ...rows] = csv.trim().split('\n');
  return { head: head!.split(','), rows: rows.map((l) => l.split(',')) };
};

describe('CSV 내보내기 (사양서 6.9, 10.1)', () => {
  it('열 순서·이름(단위 포함)이 정해진 대로', () => {
    const { head } = parse(sessionCsv({ ...input, ref: { trace: best.trace, lapTimeMs: best.lapTimeMs } }));
    expect(head).toEqual([
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
    ]);
    expect(head).toEqual([...CSV_COLUMNS]);
  });

  it('10 Hz 한 행에 한 시점, utc_time은 ISO(ms)이고 계속 늘어난다, 단위 변환(km/h, g)', () => {
    const { head, rows } = parse(sessionCsv({ ...input, ref: null }));
    expect(rows.length).toBe(r.processed.n);
    const col = (n: string) => head.indexOf(n);
    let prev = -Infinity;
    for (const row of rows) {
      const u = row[col('utc_time')]!;
      expect(u).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      const ms = Date.parse(u);
      expect(ms).toBeGreaterThan(prev);
      prev = ms;
    }
    const k = Math.floor(rows.length / 2);
    expect(Number(rows[k]![col('speed_kmh')])).toBeCloseTo(r.processed.speed[k]! * 3.6, 0);
    const gl = rows.map((x) => Number(x[col('g_lat')])).filter((v) => Number.isFinite(v));
    expect(Math.max(...gl.map(Math.abs))).toBeLessThan(2);
    expect(Math.max(...gl.map(Math.abs))).toBeGreaterThan(0.3);
    expect(rows[k]![col('lat')]!.split('.')[1]!.length).toBeLessThanOrEqual(7);
  });

  it('비교 랩이 없으면 delta_s는 빈칸, 있으면 랩 안에서 숫자. 출발 게이트 전은 lap 0', () => {
    const none = parse(sessionCsv({ ...input, ref: null }));
    const d0 = none.head.indexOf('delta_s');
    expect(none.rows.every((x) => x[d0] === '')).toBe(true);
    expect(none.rows[0]![none.head.indexOf('lap')]).toBe('0');
    const withRef = parse(sessionCsv({ ...input, ref: { trace: best.trace, lapTimeMs: best.lapTimeMs } }));
    const inLap = withRef.rows.filter((x) => x[withRef.head.indexOf('lap')] !== '0');
    expect(inLap.length).toBeGreaterThan(100);
    const deltas = inLap.map((x) => x[d0]).filter((v) => v !== '').map(Number);
    expect(deltas.length).toBeGreaterThan(inLap.length * 0.9);
    // 베스트 랩 자신과 비교하면 델타는 0 근처
    const bestRows = withRef.rows.filter((x) => x[withRef.head.indexOf('lap')] === String(best.lapNo)).map((x) => Number(x[d0]));
    expect(Math.max(...bestRows.map(Math.abs))).toBeLessThan(0.3);
  });

  it('고른 랩만 (앞뒤 5초 여유 포함 선택)', () => {
    const only = parse(sessionCsv({ ...input, ref: null, range: { laps: [2], paddingS: 0 } }));
    const lapCol = only.head.indexOf('lap');
    expect(new Set(only.rows.map((x) => x[lapCol]))).toEqual(new Set(['2']));
    const padded = parse(sessionCsv({ ...input, ref: null, range: { laps: [2], paddingS: 5 } }));
    expect(padded.rows.length).toBeGreaterThan(only.rows.length + 90);
  });

  it('M7 전에 처리한 결과(utc·hAcc 열 없음)도 세션 시작 시각 기준으로 내보낸다', () => {
    const { utc: _u, hAcc: _h, ...old } = r.processed;
    const { head, rows } = parse(sessionCsv({ ...input, processed: old, ref: null }));
    expect(Date.parse(rows[0]![0]!)).toBe(s.startedAtEpochMs + r.processed.t[0]!);
    expect(rows.every((x) => x[head.indexOf('gps_acc_m')] === '')).toBe(true);
  });

  it('채널(13.2 OBD)은 고정 열 뒤에 덧붙인다', () => {
    const { head, rows } = parse(sessionCsv({ ...input, ref: null, channels: { obd_rpm: { t: [0, 1e9], v: [3000, 3000] } } }));
    expect(head.at(-1)).toBe('obd_rpm');
    expect(head.length).toBe(CSV_COLUMNS.length + 1);
    expect(rows[10]!.at(-1)).toBe('3000');
  });

  it('랩 요약 CSV와 파일 이름 (KST)', () => {
    const { head, rows } = parse(lapsCsv(r.laps));
    expect(head).toEqual(['lap', 'lap_time_s', 's1_s', 's2_s', 's3_s', 'valid', 'invalid_reason']);
    expect(rows.length).toBe(r.laps.length);
    expect(Number(rows[0]![1])).toBeCloseTo(r.laps[0]!.lapTimeMs / 1000, 3);
    expect(csvFileName('인제 풀코스/연습', Date.UTC(2026, 10, 12, 5, 31))).toBe('gachitayo_인제_풀코스_연습_20261112-1431.csv');
    expect(csvFileName(null, Date.UTC(2026, 10, 12, 5, 31), 'laps')).toBe('gachitayo_코스없음_20261112-1431_laps.csv');
  });
});
