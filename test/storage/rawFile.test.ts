import { describe, expect, it } from 'vitest';
import { buildRawFile, readRawFile } from '../../src/storage/rawFile';
import { gunzipJson, gzipJson } from '../../src/storage/gzip';
import { rawFileName } from '../../src/storage/exportFile';
import type { ChunkRecord, SessionRecord } from '../../src/types/session';

const session: SessionRecord = {
  id: '1a2b3c4d-0000-4000-8000-000000000000',
  courseId: null,
  courseVersion: null,
  status: 'finished',
  startedAt: Date.UTC(2026, 10, 12, 1, 22),
  endedAt: null,
  device: { os: 'Android 15', browser: 'Chrome 142', userAgent: 'ua', standalone: true },
  calibration: null,
  summary: null,
};

const chunk = (seq: number, t: number): ChunkRecord => ({
  sessionId: session.id,
  seq,
  gps: [
    {
      tRecv: t + 0.123456,
      tFix: session.startedAt + t,
      lat: 37.123456789,
      lon: 127.987654321,
      alt: 41.2345,
      altAcc: null,
      hAcc: 4.567,
      speed: 12.3456,
      heading: null,
    },
  ],
  rawMotion: [{ t: t + 1.005, gax: 9.80665, gay: -0.12345, gaz: 0.0004, rx: 0.123456, ry: null, rz: -1.5 }],
  events: [{ t, type: 'pause' }],
});

describe('센서 채널 자리 (사양서 13.2 OBD 확장 지점)', () => {
  it('덩어리의 채널을 이름별로 seq 순서대로 이어 붙이고, 없으면 빈 객체', () => {
    const a = { ...chunk(1, 5000), channels: { obd_rpm: { t: [5000.123, 5100], v: [3200.4, 3300] } } };
    const b = { ...chunk(0, 0), channels: { obd_rpm: { t: [10], v: [900] }, obd_throttle: { t: [20], v: [12.345] } } };
    const f = buildRawFile(session, [a, b]);
    expect(f.channels).toEqual({ obd_rpm: { t: [10, 5000.12, 5100], v: [900, 3200.4, 3300] }, obd_throttle: { t: [20], v: [12.35] } });
    expect(buildRawFile(session, [chunk(0, 0)]).channels).toEqual({});
    // 읽기: 채널이 없는 예전 파일도 읽힌다
    const { channels } = readRawFile({ ...buildRawFile(session, [chunk(0, 0)]), channels: undefined });
    expect(channels).toEqual({});
    expect(readRawFile(f).channels.obd_rpm!.v).toEqual([900, 3200.4, 3300]);
  });
});

describe('buildRawFile', () => {
  it('덩어리 순서가 섞여 있어도 seq 순서로 이어 붙인다', () => {
    const f = buildRawFile(session, [chunk(1, 5000), chunk(0, 0)]);
    expect(f.gps.tFix).toEqual([session.startedAt, session.startedAt + 5000]);
    expect(f.events.map((e) => e.t)).toEqual([0, 5000]);
  });

  it('머리 정보를 담는다', () => {
    const f = buildRawFile(session, []);
    expect(f.formatVersion).toBe(1);
    expect(f.sessionId).toBe(session.id);
    expect(f.startedAtEpochMs).toBe(session.startedAt);
    expect(f.device).toEqual(session.device);
    expect(f.calibration).toBeNull();
  });

  it('자릿수를 제한한다: 위경도 7, 가속도·회전 속도 3, 나머지 2', () => {
    const f = buildRawFile(session, [chunk(0, 0)]);
    expect(f.gps.lat).toEqual([37.1234568]);
    expect(f.gps.lon).toEqual([127.9876543]);
    expect(f.gps.hAcc).toEqual([4.57]);
    expect(f.gps.alt).toEqual([41.23]);
    expect(f.gps.speed).toEqual([12.35]);
    expect(f.gps.tRecv).toEqual([0.12]);
    expect(f.motion.t).toEqual([1.01]);
    expect(f.motion.gax).toEqual([9.807]);
    expect(f.motion.gay).toEqual([-0.123]);
    expect(f.motion.gaz).toEqual([0]);
    expect(f.motion.rx).toEqual([0.123]);
    expect(f.motion.rz).toEqual([-1.5]);
  });

  it('없는 값(null)은 그대로 null이고, 모든 열의 길이가 같다', () => {
    const f = buildRawFile(session, [chunk(0, 0), chunk(1, 5000)]);
    expect(f.gps.altAcc).toEqual([null, null]);
    expect(f.gps.heading).toEqual([null, null]);
    expect(f.motion.ry).toEqual([null, null]);
    for (const col of Object.values(f.gps)) expect(col).toHaveLength(2);
    for (const col of Object.values(f.motion)) expect(col).toHaveLength(2);
  });
});

describe('gzip 왕복과 readRawFile', () => {
  it('압축했다 풀어서 읽으면 자릿수 제한한 샘플이 그대로 나온다', async () => {
    const f = buildRawFile(session, [chunk(0, 0), chunk(1, 5000)]);
    const bytes = await gzipJson(f);
    expect(bytes[0]).toBe(0x1f); // gzip 시그니처
    expect(bytes[1]).toBe(0x8b);
    const back = readRawFile(await gunzipJson(bytes));
    expect(back.gps).toHaveLength(2);
    expect(back.gps[1]).toEqual({
      tRecv: 5000.12,
      tFix: session.startedAt + 5000,
      lat: 37.1234568,
      lon: 127.9876543,
      alt: 41.23,
      altAcc: null,
      hAcc: 4.57,
      speed: 12.35,
      heading: null,
    });
    expect(back.motion[0]).toEqual({ t: 1.01, gax: 9.807, gay: -0.123, gaz: 0, rx: 0.123, ry: null, rz: -1.5 });
    expect(back.events).toEqual([
      { t: 0, type: 'pause' },
      { t: 5000, type: 'pause' },
    ]);
  });

  it('형식 버전이 다르면 읽지 않는다', () => {
    expect(() => readRawFile({ formatVersion: 2 })).toThrow();
  });
});

describe('rawFileName', () => {
  it('KST 시작 시각과 세션 id 앞 8자리로 이름을 만든다', () => {
    expect(rawFileName(session, 'json.gz')).toBe('gachitayo-20261112-1022-1a2b3c4d.raw.json.gz');
    expect(rawFileName(session, 'json')).toBe('gachitayo-20261112-1022-1a2b3c4d.raw.json');
  });
});
