import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseXml } from '../../src/gpx/xml';
import { parseGpx } from '../../src/gpx/parse';
import { courseFromGpx, gpsSamplesFromGpx } from '../../src/gpx/course';
import { courseToGpx, sessionToGpx } from '../../src/gpx/export';
import { buildGeometry } from '../../src/engine/course/geometry';
import { nearestOnPolyline } from '../../src/engine/course/polyline';
import { processDrive } from '../../src/engine/process/processDrive';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, windingWithHairpins } from '../generators';
import { courseFromTrack } from '../engine/course/helpers';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/gpx/${name}`, import.meta.url), 'utf8');

describe('XML 파서', () => {
  it('요소·속성·글자·엔티티·주석·CDATA', () => {
    const r = parseXml(`<?xml version="1.0"?><!-- c --><a x="1" y='&lt;2&gt;'><b>t &amp; u &#65;&#x42;</b><c/><d><![CDATA[<raw>]]></d></a>`);
    expect(r.name).toBe('a');
    expect(r.attrs).toEqual({ x: '1', y: '<2>' });
    expect(r.children.map((c) => c.name)).toEqual(['b', 'c', 'd']);
    expect(r.children[0]!.text).toBe('t & u AB');
    expect(r.children[2]!.text).toBe('<raw>');
  });

  it('잘못된 XML은 분명한 오류', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/XML/);
    expect(() => parseXml('')).toThrow(/XML/);
  });
});

describe('GPX 불러오기 (사양서 8.7)', () => {
  it('가민 TrackPointExtension 속도, 여러 trkseg, 밀리초 시각, 이름', () => {
    const g = parseGpx(fixture('garmin-tpx.gpx'));
    expect(g.source).toBe('trk');
    expect(g.name).toBe('아침 주행 & 테스트');
    expect(g.points).toHaveLength(3);
    expect(g.points.map((p) => p.speed)).toEqual([12.5, 13, null]);
    expect(g.points[2]!.time).toBe(Date.UTC(2026, 10, 12, 1, 0, 2, 500));
    expect(g.points[0]!.ele).toBe(50.2);
    expect(g.hasTime).toBe(true);
  });

  it('GPX 1.0의 <speed>', () => {
    expect(parseGpx(fixture('gpx10-speed.gpx')).points.map((p) => p.speed)).toEqual([8.25, 8.5]);
  });

  it('이름공간 접두사가 달라도 읽는다', () => {
    const g = parseGpx(fixture('prefixed.gpx'));
    expect(g.points).toHaveLength(2);
    expect(g.points[0]!.speed).toBe(5);
  });

  it('trk가 없으면 rte 점을 쓴다', () => {
    const g = parseGpx(fixture('route-only.gpx'));
    expect(g.source).toBe('rte');
    expect(g.points).toHaveLength(3);
    expect(g.hasTime).toBe(false);
  });

  it('시간이 없는 GPX는 코스로는 되지만 주행 기록으로는 안 된다', () => {
    const g = parseGpx(fixture('no-time.gpx'));
    expect(g.hasTime).toBe(false);
    expect(() => gpsSamplesFromGpx(g)).toThrow(/시간/);
    expect(courseFromGpx(g, { id: 'g1', name: '코스' }).kind).toBe('point_to_point');
  });

  it('GPX가 아니거나 점이 없으면 분명한 오류', () => {
    expect(() => parseGpx('<kml></kml>')).toThrow(/GPX/);
    expect(() => parseGpx('<gpx version="1.1"></gpx>')).toThrow(/점/);
  });
});

describe('GPX 왕복 (사양서 10.1)', () => {
  for (const [name, track] of [
    ['랩 코스', stadiumTrack()],
    ['편도', windingWithHairpins()],
  ] as const) {
    it(`코스(${name}): 내보낸 뒤 불러오면 종류·출발선이 같고 중심선이 0.1 m 안`, () => {
      const course = courseFromTrack(track, { gateAtS: 0 });
      const back = courseFromGpx(parseGpx(courseToGpx(course)), { id: 'r', name: course.name });
      expect(back.kind).toBe(course.kind);
      const a = buildGeometry(course);
      const b = buildGeometry(back);
      expect(Math.hypot(a.start.cx - b.start.cx, a.start.cy - b.start.cy)).toBeLessThan(0.5);
      expect(Math.abs(((course.startGate.bearingDeg - back.startGate.bearingDeg + 540) % 360) - 180)).toBeLessThan(2);
      let worst = 0;
      for (let i = 0; i < b.centerline!.x.length; i += 3) {
        worst = Math.max(worst, nearestOnPolyline(a.centerline!, b.centerline!.x[i]!, b.centerline!.y[i]!).d);
      }
      expect(worst).toBeLessThan(0.1);
    });
  }

  it('주행 기록: 내보낸 뒤 불러오면 같은 점, 다시 내보내면 같은 파일, 같은 처리 결과', () => {
    const truth = simulateDrive(stadiumTrack(), { laps: 2, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });
    const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 91 });
    const gpx1 = sessionToGpx({ name: '세션', gps: s.gps });
    const in1 = gpsSamplesFromGpx(parseGpx(gpx1));
    expect(in1).toHaveLength(s.gps.length);
    in1.forEach((g, i) => {
      const o = s.gps[i]!;
      expect(g.lat).toBeCloseTo(o.lat, 7);
      expect(g.lon).toBeCloseTo(o.lon, 7);
      expect(g.tFix).toBe(o.tFix);
      expect(g.speed).toBeCloseTo(o.speed!, 2);
    });
    const gpx2 = sessionToGpx({ name: '세션', gps: in1 });
    expect(gpx2).toBe(gpx1);
    const in2 = gpsSamplesFromGpx(parseGpx(gpx2));
    const r1 = processDrive({ gps: in1, motion: [], events: [], course: null });
    const r2 = processDrive({ gps: in2, motion: [], events: [], course: null });
    expect(r2.laps.map((l) => l.lapTimeMs)).toEqual(r1.laps.map((l) => l.lapTimeMs));
    expect(r2.processed.lat).toEqual(r1.processed.lat);
  });
});
