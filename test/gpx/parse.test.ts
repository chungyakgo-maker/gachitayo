import { describe, expect, it } from 'vitest';
import { parseGpx, suggestedCourseName } from '../../src/gpx/parse';

describe('GPX 코스 이름 기본값 (사용자 요청: 카카오맵 GPX는 이름이 늘 "kakaomap")', () => {
  const kakao = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="kakaomap-route">
  <metadata><name>kakaomap</name></metadata>
  <wpt lat="37.9578" lon="127.7796"><name>강원 춘천시 신북읍 유포리 산 5-13</name></wpt>
  <wpt lat="37.99" lon="127.80"><name>만항재쉼터</name></wpt>
  <trk><trkseg><trkpt lat="37.9578" lon="127.7796"><ele>200</ele></trkpt><trkpt lat="37.99" lon="127.80"><ele>300</ele></trkpt></trkseg></trk>
</gpx>`;
  it('경유점(출발·도착 이름)을 읽는다', () => {
    const g = parseGpx(kakao);
    expect(g.waypoints.map((w) => w.name)).toEqual(['강원 춘천시 신북읍 유포리 산 5-13', '만항재쉼터']);
    expect(g.points.length).toBe(2);
  });
  it('GPX 이름이 뜻 없으면 파일 이름, 파일 이름도 뜻 없으면 출발 → 도착 지명', () => {
    const g = parseGpx(kakao);
    expect(suggestedCourseName(g, '배후령.gpx')).toBe('배후령');
    expect(suggestedCourseName(g, 'kakaomap.gpx')).toBe('유포리 → 만항재쉼터');
    expect(suggestedCourseName(g)).toBe('유포리 → 만항재쉼터');
    expect(suggestedCourseName({ ...g, name: '북악 스카이웨이' }, 'x.gpx')).toBe('북악 스카이웨이');
    expect(suggestedCourseName({ name: null, waypoints: [] }, 'route_01.gpx')).toBe('route_01');
    expect(suggestedCourseName({ name: null, waypoints: [] })).toBe('GPX 코스');
  });
});
