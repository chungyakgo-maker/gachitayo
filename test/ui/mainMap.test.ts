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
    expect(labels).toEqual(expect.arrayContaining(['출발', '도착', '나']));
    expect(el.querySelector('path[stroke-dasharray="4 3"]')).not.toBeNull();
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
});
