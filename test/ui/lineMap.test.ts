import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINE_MAP_COLORS, lineMapStyle, lineMapUrls } from '../../src/ui/map/lineStyle';
import { lineShapes, PIN_TEXT } from '../../src/ui/map/lineShapes';
import { lineMapConfig, resetLineMapProbe } from '../../src/ui/map/lineMapSupport';
import type { MapShape } from '../../src/ui/map/courseStyle';

describe('선 지도 모양 (사양서 8.9, 시안 2)', () => {
  const urls = lineMapUrls('https://api.example.workers.dev');
  const style = lineMapStyle({ tiles: urls.tiles, glyphs: urls.glyphs, maxzoom: 14 });
  const layer = (id: string) => style.layers.find((l) => l.id === id) as unknown as { paint: Record<string, unknown>; filter?: unknown; minzoom?: number };

  it('서버 주소: 타일 · 글자 조각 · 정보', () => {
    expect(urls).toEqual({
      tiles: 'https://api.example.workers.dev/map/tiles/{z}/{x}/{y}.mvt',
      glyphs: 'https://api.example.workers.dev/map/fonts/{fontstack}/{range}.pbf',
      info: 'https://api.example.workers.dev/map/info',
    });
    expect(style.sources.pm).toMatchObject({ type: 'vector', tiles: [urls.tiles], maxzoom: 14 });
    expect(style.glyphs).toBe(urls.glyphs);
  });

  it('우리 앱 색: 바다 숯색, 땅 칸 색, 도로는 포인트 하늘색(고속도로가 가장 밝게), 작은 길은 회색으로 확대했을 때만', () => {
    expect(layer('bg').paint['background-color']).toBe(LINE_MAP_COLORS.sea);
    expect(layer('earth').paint['fill-color']).toBe('#101114');
    expect(layer('road-highway').paint['line-color']).toBe('#aacae6');
    expect(layer('road-major').paint['line-color']).toBe('#aacae6');
    expect(layer('road-highway').paint['line-opacity'] as number).toBeGreaterThan(layer('road-major').paint['line-opacity'] as number);
    expect(layer('road-minor').paint['line-color']).toBe('#9aa1a9');
    expect(layer('road-minor').minzoom).toBe(11);
  });

  it('지명: 도·시·읍면·산. 한국어 이름이 있으면 그것으로. 그리는 순서는 도로 위', () => {
    const ids = style.layers.map((l) => l.id);
    for (const id of ['name-region', 'name-city', 'name-town', 'name-peak']) expect(ids.indexOf(id)).toBeGreaterThan(ids.indexOf('road-highway'));
    const city = style.layers.find((l) => l.id === 'name-city') as unknown as { layout: Record<string, unknown> };
    expect(city.layout['text-field']).toEqual(['coalesce', ['get', 'name:ko'], ['get', 'name']]);
  });
});

describe('코스 모양 → 선 지도 데이터', () => {
  const shapes: MapShape[] = [
    { kind: 'route', pts: [[37.1, 128.9], [37.2, 129.0]] },
    { kind: 'gate', a: [37.1, 128.89], b: [37.1, 128.91], which: 'start' },
    { kind: 'gate', a: [37.2, 128.99], b: [37.2, 129.01], which: 'finish' },
    { kind: 'sector', at: [37.15, 128.95], text: '1|2' },
    { kind: 'pin', at: [37.1, 128.9], which: 'start', text: 'START' },
    { kind: 'line', pts: [[37.1, 128.9], [37.11, 128.9]], color: '#eceef0', weight: 3, dash: '6 4' },
    { kind: 'dot', at: [37.3, 129.1], color: '#aacae6', r: 8 },
    { kind: 'label', at: [37.3, 129.1], text: '여기' },
  ];
  const g = lineShapes(shapes);

  it('위경도 순서를 [경도, 위도]로 바꾸고 종류별로 나눈다', () => {
    expect(g.routes.features[0]!.geometry.coordinates).toEqual([
      [128.9, 37.1],
      [129.0, 37.2],
    ]);
    expect(g.gates.features.map((f) => f.properties.which)).toEqual(['start', 'finish']);
    expect(g.dashed.features).toHaveLength(1);
    expect(g.lines.features).toHaveLength(0);
    expect(g.dots.features[0]!.properties).toEqual({ color: '#aacae6', r: 8 });
    expect(g.sectors).toEqual([{ at: [128.95, 37.15], text: '1|2' }]);
    expect(g.pins).toEqual([{ at: [128.9, 37.1], which: 'start', text: 'START' }]);
    expect(g.labels).toEqual([{ at: [129.1, 37.3], text: '여기' }]);
  });

  it('핀·구간 글자 자리를 지명이 피해 가도록 알려 준다', () => {
    expect(g.blockers.features.map((f) => f.properties)).toEqual([
      { t: '1|2', s: 15, a: 'bottom', o: [0, -0.8] },
      { t: 'START', s: PIN_TEXT.size, a: 'bottom', o: [...PIN_TEXT.offset] },
    ]);
    // 사용자 요청: START / FINISH 글자는 작게 (화면 글자와 같은 13 px)
    expect(PIN_TEXT.size).toBe(13);
  });
});

describe('선 지도를 쓸 수 있는지', () => {
  afterEach(() => {
    resetLineMapProbe(true);
    vi.unstubAllGlobals();
  });

  it('서버 주소가 없거나 WebGL이 없으면 사진 지도', async () => {
    expect(await lineMapConfig('')).toBeNull();
    expect(await lineMapConfig('https://api.example.workers.dev')).toBeNull(); // jsdom에는 WebGL이 없다
  });

  it('WebGL이 있고 서버에 지도 데이터가 있으면 선 지도 (확대 한도는 서버 정보로)', async () => {
    vi.stubGlobal('WebGLRenderingContext', function () {});
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ maxZoom: 14 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await lineMapConfig('https://api.example.workers.dev')).toEqual({
      tiles: 'https://api.example.workers.dev/map/tiles/{z}/{x}/{y}.mvt',
      glyphs: 'https://api.example.workers.dev/map/fonts/{fontstack}/{range}.pbf',
      maxzoom: 14,
    });
    await lineMapConfig('https://api.example.workers.dev');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    getContext.mockRestore();
  });

  it('한 번 쓸 수 있었으면 다음에는 서버에 묻기 전에 바로 쓰고(통신이 없어도), 뒤에서 다시 확인해 없어졌으면 다음부터 사진 지도', async () => {
    vi.stubGlobal('WebGLRenderingContext', function () {});
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    const api = 'https://api.example.workers.dev';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ maxZoom: 14 }), { status: 200 })));
    expect((await lineMapConfig(api))?.maxzoom).toBe(14);
    resetLineMapProbe();
    // 다음 실행: 서버가 늦거나 안 돼도 바로
    let answer: (r: Response) => void = () => {};
    const slow = vi.fn(() => new Promise<Response>((res) => (answer = res)));
    vi.stubGlobal('fetch', slow);
    expect((await lineMapConfig(api))?.maxzoom).toBe(14);
    expect(slow).toHaveBeenCalledTimes(1); // 뒤에서 확인
    answer(new Response('{}', { status: 404 }));
    await new Promise((r) => setTimeout(r, 0));
    resetLineMapProbe();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await lineMapConfig(api)).toBeNull();
    getContext.mockRestore();
  });

  it('서버에 지도 데이터가 아직 없으면(404) 사진 지도', async () => {
    vi.stubGlobal('WebGLRenderingContext', function () {});
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await lineMapConfig('https://api.example.workers.dev')).toBeNull();
    getContext.mockRestore();
  });
});

describe('메인·주행·분석 선 지도 도우미', () => {
  it('확대 단계: 사진 지도보다 1 작은 값이 같은 넓이 (512px 타일)', async () => {
    const { lineZoom } = await import('../../src/ui/map/lineShapes');
    expect(lineZoom(17)).toBe(16);
  });

  it('진행 방향 → 나침반 방위 (동쪽 90°, 북쪽 0°, 서쪽 270°)', async () => {
    const { headingToBearing } = await import('../../src/ui/map/lineShapes');
    expect(headingToBearing(0)).toBeCloseTo(90, 9);
    expect(headingToBearing(Math.PI / 2)).toBeCloseTo(0, 9);
    expect(headingToBearing(Math.PI)).toBeCloseTo(270, 9);
    expect(headingToBearing(-Math.PI / 2)).toBeCloseTo(180, 9);
  });

  it('오차 원: 닫힌 다각형, 중심에서 반지름만큼', async () => {
    const { circlePolygon } = await import('../../src/ui/map/lineShapes');
    const ring = circlePolygon(37.5, 127, 50, 36);
    expect(ring).toHaveLength(37);
    expect(ring[0]).toEqual(ring[36]);
    for (const [lon, lat] of ring) {
      const d = Math.hypot((lat - 37.5) * 111_320, (lon - 127) * 111_320 * Math.cos((37.5 * Math.PI) / 180));
      expect(Math.abs(d - 50)).toBeLessThan(0.01);
    }
  });

  it('메인 지도 코스: 선 · 출발선(편도면 도착선) · 핀, 구간 경계는 없음', async () => {
    const { mainCourseShapes } = await import('../../src/ui/map/lineShapes');
    const { BUILTIN_COURSES, builtinCourse } = await import('../../src/courses/builtin');
    const { BUILTIN_POINTS } = await import('../../src/courses/builtinData');
    const b = BUILTIN_COURSES[0]!;
    const c = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: 'x', gateWidthM: 30 });
    expect(mainCourseShapes(c).map((s) => s.kind)).toEqual(['route', 'gate', 'gate', 'pin', 'pin']);
    const loop = { ...c, kind: 'loop' as const, finishGate: c.startGate };
    const shapes = mainCourseShapes(loop);
    expect(shapes.map((s) => s.kind)).toEqual(['route', 'gate', 'pin']);
    const route = shapes[0] as { pts: Array<[number, number]> };
    expect(route.pts[route.pts.length - 1]).toEqual(route.pts[0]); // 랩은 닫는다
  });

  it('분석 지도: 랩 A는 속도 색 조각(같은 색은 묶음), 색이 없으면 한 줄', async () => {
    const { lapSegments } = await import('../../src/ui/map/lineShapes');
    const pts: Array<[number, number]> = [
      [37, 127],
      [37.001, 127],
      [37.002, 127.001],
    ];
    const segs = lapSegments({ pts, colors: ['#000', '#f00', '#0f0'] }, '#aacae6');
    expect(segs.map((f) => f.properties.color)).toEqual(['#f00', '#0f0']);
    expect(segs[0]!.geometry.coordinates).toEqual([
      [127, 37],
      [127, 37.001],
    ]);
    expect(lapSegments({ pts, colorAll: '#9aa1a9' }, '#aacae6').map((f) => f.properties.color)).toEqual(['#9aa1a9']);
    // 같은 색이 이어지면 한 조각 (짧은 조각이 넓게 볼 때 사라지지 않게)
    const four: Array<[number, number]> = [...pts, [37.003, 127.002]];
    const merged = lapSegments({ pts: four, colors: ['#000', '#f00', '#f00', '#0f0'] }, '#aacae6');
    expect(merged.map((f) => [f.properties.color, f.geometry.coordinates.length])).toEqual([
      ['#f00', 3],
      ['#0f0', 2],
    ]);
    expect(merged[1]!.geometry.coordinates[0]).toEqual([127.001, 37.002]); // 이어지게 앞 조각 끝점부터
    expect(lapSegments(null, '#aacae6')).toEqual([]);
  });
});
