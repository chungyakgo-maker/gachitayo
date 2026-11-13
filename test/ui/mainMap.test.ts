import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Course } from '../../src/types/course';

// jsdom의 SVG에는 createSVGRect가 없어 Leaflet이 캔버스로 그리려 한다. SVG로 그리게 한다 (Leaflet을 불러오기 전에)
beforeAll(() => {
  (SVGSVGElement.prototype as unknown as { createSVGRect: () => object }).createSVGRect = () => ({});
});

const course: Course = {
  id: 'c1',
  name: '테스트',
  kind: 'point_to_point',
  source: 'auto',
  origin: { lat: 37.2, lon: 127.1 },
  startGate: { lat: 37.2, lon: 127.1, bearingDeg: 0, widthM: 30 },
  finishGate: { lat: 37.201, lon: 127.101, bearingDeg: 90, widthM: 30 },
  centerline: [
    [37.2, 127.1],
    [37.201, 127.1],
    [37.201, 127.101],
  ],
  lengthM: 200,
  sectorBoundsM: [66, 133],
  version: 1,
};

function host() {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 390 });
  Object.defineProperty(el, 'clientHeight', { value: 500 });
  document.body.appendChild(el);
  return el;
}

describe('메인 지도 (사양서 8.2: 통신이 되면 OSM 타일, 안 되면 타일 없이)', () => {
  it('통신이 되면 OSM 타일과 출처를 보여주고, 끊기면 타일을 뺀다', async () => {
    const { createMainMap, OSM_TILE_URL } = await import('../../src/ui/map/leafletMap');
    const el = host();
    const onTiles = vi.fn();
    const m = createMainMap(el, onTiles);
    m.setOnline(true);
    expect(m.tilesShown()).toBe(true);
    expect(onTiles).toHaveBeenLastCalledWith(true);
    const img = el.querySelector<HTMLImageElement>('img.leaflet-tile');
    expect(img?.src).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
    expect(OSM_TILE_URL).toContain('tile.openstreetmap.org');
    expect(el.querySelector('.leaflet-control-attribution')?.textContent).toContain('OpenStreetMap');
    m.setOnline(false);
    expect(m.tilesShown()).toBe(false);
    expect(el.querySelector('img.leaflet-tile')).toBeNull();
    m.destroy();
  });

  it('타일이 연달아 실패하면(통신 없음) 타일 없이 그린다', async () => {
    const { createMainMap } = await import('../../src/ui/map/leafletMap');
    const el = host();
    const m = createMainMap(el);
    m.setOnline(true);
    const imgs = [...el.querySelectorAll<HTMLImageElement>('img.leaflet-tile')];
    expect(imgs.length).toBeGreaterThanOrEqual(6);
    for (const i of imgs.slice(0, 6)) i.dispatchEvent(new Event('error'));
    expect(m.tilesShown()).toBe(false);
    m.destroy();
  });

  it('코스 선, 출발선·도착선(편도), 내 위치와 정확도 원을 그리고, 코스에 맞춰 화면을 옮긴다', async () => {
    const { createMainMap } = await import('../../src/ui/map/leafletMap');
    const el = host();
    const m = createMainMap(el);
    m.update(course, { lat: 37.2002, lon: 127.1001, hAcc: 8 });
    const paths = el.querySelectorAll('path.leaflet-interactive, svg path');
    // 코스 2줄 + 출발선 + 도착선 + 정확도 원 + 내 위치 2개
    expect(paths.length).toBeGreaterThanOrEqual(7);
    const labels = [...el.querySelectorAll('.map-label')].map((n) => n.textContent);
    expect(labels).toEqual(expect.arrayContaining(['START', 'FINISH', '나']));
    // "나"는 점 아래 (출발·도착 핀은 점 위로 서므로 출발점에 서 있어도 겹치지 않게, 사용자 요청): 글자 위쪽이 점에서 12 px 아래
    const me = [...el.querySelectorAll<HTMLElement>('.map-label.me')][0]!;
    expect(me.style.marginTop).toBe('12px');
    expect(el.querySelector('path[stroke-dasharray="4 3"]')).not.toBeNull();
    m.destroy();
  });

  it('코스 그리기 (사용자 요청): 빨간 선 + 빛 번짐, 출발·도착 하늘색 핀 + START / FINISH, 출발선 하늘색', async () => {
    const { createMainMap, COURSE_STYLE } = await import('../../src/ui/map/leafletMap');
    const el = host();
    const m = createMainMap(el);
    m.update(course, null);
    expect(el.querySelectorAll(`path[stroke="${COURSE_STYLE.glow}"].course-glow`).length).toBe(2);
    expect(el.querySelector(`path[stroke="${COURSE_STYLE.route}"].course-line`)).not.toBeNull();
    expect(el.querySelector(`path[stroke="${COURSE_STYLE.start}"]`)).not.toBeNull();
    const start = el.querySelector('.map-pin.start')!;
    const finish = el.querySelector('.map-pin.finish')!;
    expect(start.querySelector('path')!.getAttribute('fill')).toBe(COURSE_STYLE.start);
    expect(finish.querySelector('path')!.getAttribute('fill')).toBe(COURSE_STYLE.finish);
    // 사용자 요청: 출발·도착 핀은 하늘색으로 통일, 글자는 영어
    expect(COURSE_STYLE.start).toBe('#aacae6');
    expect(COURSE_STYLE.finish).toBe('#aacae6');
    expect(start.querySelector('.map-label.big')!.textContent).toBe('START');
    expect(finish.querySelector('.map-label.big')!.textContent).toBe('FINISH');
    m.destroy();
  });

  it('다른 코스들도 이름과 함께 그리고 (사용자 요청), 코스 보기를 끄면 다 숨기되 지도 위치는 그대로', async () => {
    const { createMainMap } = await import('../../src/ui/map/leafletMap');
    const el = host();
    const m = createMainMap(el);
    const other: Course = { ...course, id: 'c2', name: '다른 코스', startGate: { ...course.startGate, lat: 37.21 }, centerline: [[37.21, 127.1], [37.212, 127.1]] };
    m.setCourses([course, other]);
    m.update(course, null);
    const names = () => [...el.querySelectorAll('.map-label.course-name')].map((n) => n.textContent);
    // 감지된 코스는 핀으로 그리므로 이름표는 다른 코스만
    expect(names()).toEqual(['다른 코스']);
    expect(el.querySelector('.map-pin.start')).not.toBeNull();
    m.map.setView([37.3, 127.2], 12, { animate: false });
    m.setShowCourses(false);
    expect(names()).toEqual([]);
    expect(el.querySelector('.map-pin.start')).toBeNull();
    expect(m.map.getCenter().lat).toBeCloseTo(37.3, 5);
    expect(m.map.getZoom()).toBe(12);
    m.setShowCourses(true);
    expect(names()).toEqual(['다른 코스']);
    expect(el.querySelector('.map-pin.start')).not.toBeNull();
    m.destroy();
  });

  it('코스가 없으면 내 위치를 따라가고, 사용자가 지도를 옮기면 멈췄다가 "내 위치"를 누르면 다시 따라간다', async () => {
    const { createMainMap } = await import('../../src/ui/map/leafletMap');
    const el = host();
    const m = createMainMap(el);
    const near = (a: { lat: number; lng: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lon) < 1e-5;
    const p1 = { lat: 37.5665, lon: 126.978, hAcc: 5 };
    const p2 = { lat: 37.567, lon: 126.979, hAcc: 5 };
    const p3 = { lat: 37.568, lon: 126.98, hAcc: 5 };
    m.update(null, p1);
    expect(near(m.map.getCenter(), p1)).toBe(true);
    m.update(null, p2);
    expect(near(m.map.getCenter(), p2)).toBe(true);
    // 사용자가 지도를 끌어서 옮김
    m.map.fire('dragstart');
    m.map.setView([37.6, 127.0], 14, { animate: false });
    m.update(null, p3);
    expect(near(m.map.getCenter(), { lat: 37.6, lon: 127.0 })).toBe(true);
    // "내 위치"
    m.locate(p3);
    expect(near(m.map.getCenter(), p3)).toBe(true);
    expect(m.map.getZoom()).toBeGreaterThanOrEqual(16);
    m.update(null, p1);
    expect(near(m.map.getCenter(), p1)).toBe(true);
    m.destroy();
  });

  it('위치 공유 중인 친구를 점과 닉네임으로 그리고(오래된 위치는 흐리게), 닉네임은 글자로만 넣는다', async () => {
    const { createMainMap } = await import('../../src/ui/map/leafletMap');
    const el = host();
    const m = createMainMap(el);
    m.setFriends([
      { userId: 'u2', nickname: '지훈', lat: 37.5665, lon: 126.978, ageMs: 2000 },
      { userId: 'u3', nickname: '<b>남</b>', lat: 37.57, lon: 126.98, ageMs: 60_000 },
    ]);
    const labels = [...el.querySelectorAll('.map-label.friend')];
    expect(labels.map((n) => n.textContent)).toEqual(['지훈', '<b>남</b>']);
    expect(el.querySelector('.map-label.friend b')).toBeNull();
    expect(labels[1]!.classList.contains('stale')).toBe(true);
    m.fitFriends({ lat: 37.56, lon: 126.97, hAcc: 5 });
    const b = m.map.getBounds();
    for (const [lat, lon] of [[37.5665, 126.978], [37.57, 126.98], [37.56, 126.97]]) expect(b.contains([lat!, lon!])).toBe(true);
    m.setFriends([]);
    expect(el.querySelectorAll('.map-label.friend').length).toBe(0);
    m.destroy();
  });
});

describe('가려지지 않은 영역 가운데 (사용자 요청: 지도는 화면 전체, 칸들은 위에 얹는다)', () => {
  it('메인 지도: 위 카드 190 px, 아래 탭 70 px이면 내 위치는 (190 + 430) / 2 = 310 px 높이에', async () => {
    const { createMainMap } = await import('../../src/ui/map/leafletMap');
    const el = host();
    const m = createMainMap(el);
    m.setInsets(190, 70);
    const me = { lat: 37.39, lon: 126.95, hAcc: 5 };
    m.update(null, me);
    const p = m.map.latLngToContainerPoint([me.lat, me.lon]);
    expect(p.x).toBeCloseTo(195, 0);
    expect(p.y).toBeCloseTo((190 + (500 - 70)) / 2, 0);
    m.locate(me);
    expect(m.map.latLngToContainerPoint([me.lat, me.lon]).y).toBeCloseTo(310, 0);
    m.destroy();
  });

  it('주행·재생 지도: 나를 가운데 보기도 게이지 아래 ~ 종료 버튼 위의 가운데에', async () => {
    const { createReplayMap } = await import('../../src/ui/map/leafletMap');
    const el = host();
    const r = createReplayMap(el);
    r.follow(37.2, 127.1, { top: 240, bottom: 80 });
    const p = r.project(37.2, 127.1);
    expect(p.x).toBeCloseTo(195, 0);
    expect(p.y).toBeCloseTo((240 + (500 - 80)) / 2, 0);
    // 지도 출처는 지도판 밖 글자로 (돌아가도 바로 보이게)
    expect(el.querySelector('.leaflet-control-attribution')).toBeNull();
    r.destroy();
  });
});

describe('매 프레임 따라가기 (사용자 요청: 지도가 뚝뚝 끊긴다)', () => {
  it('track: 다시 맞추지 않고 밀어서 내 위치를 가려지지 않은 영역 가운데에 둔다', async () => {
    const { createReplayMap } = await import('../../src/ui/map/leafletMap');
    const el = host();
    const r = createReplayMap(el);
    const inset = { top: 240, bottom: 80 };
    r.track(37.2, 127.1, inset);
    for (let i = 1; i <= 10; i++) r.track(37.2 + i * 0.00002, 127.1, inset);
    const p = r.project(37.2 + 10 * 0.00002, 127.1);
    expect(p.x).toBeCloseTo(195, 0);
    expect(Math.abs(p.y - (240 + (500 - 80)) / 2)).toBeLessThanOrEqual(1);
    r.destroy();
  });
});
