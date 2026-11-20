import { describe, expect, it } from 'vitest';
import { fakeCtx } from './fakeCtx';
import { BIKE_MARK, type BikeMarker } from '../../../src/ui/overlay/bikeMarks';
import { drawDeltaPanel, drawGTile, drawValueTile, gMeterLabel } from '../../../src/ui/overlay/draw';
import { frameFromLive, headline, widgetValue, type OverlayFrame, type XY } from '../../../src/ui/overlay/frame';
import { anchorPadding, COURSE_DONE, COURSE_LINE, drawMiniMap, fitView, followView, mapModel, drawMeIcon, ME_ANCHOR, ME_MARKER, PATH_STYLE, routeDoneS } from '../../../src/ui/overlay/minimap';
import { overlayTheme } from '../../../src/ui/overlay/theme';
import type { Course } from '../../../src/types/course';
import type { LiveState } from '../../../src/engine/live/liveEngine';

const th = overlayTheme('green-red');

const frame = (p: Partial<OverlayFrame> = {}): OverlayFrame => ({
  t: 100_000,
  hasState: true,
  hasCourse: true,
  hasRef: true,
  lapNo: 4,
  lapElapsedMs: 72_449,
  delta: 0.425,
  speedKmh: 142.4,
  maxSpeedKmh: 186.2,
  gx: -0.31,
  gy: 0.82,
  currentSector: 1,
  sectorDeltas: [-0.12, -0.19, null],
  me: { x: 10, y: 20, psi: 0.5 },
  ghost: { x: 15, y: 25 },
  ...p,
});

const course: Course = {
  id: 'c1',
  name: '테스트',
  kind: 'loop',
  source: 'auto',
  origin: { lat: 37.2, lon: 127.1 },
  startGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  finishGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  centerline: [
    [37.2, 127.1],
    [37.201, 127.1],
    [37.201, 127.101],
  ],
  lengthM: 200,
  sectorBoundsM: [66, 133],
  version: 1,
};

describe('오버레이 상태 (시각 t의 주행 상태, 사양서 13.1)', () => {
  it('델타 패널 글자: 코스 없음 / 비교 랩 없음 / 출발 전 / 델타', () => {
    expect(headline(frame({ hasCourse: false }))).toMatchObject({ label: '코스 기록 중 · 출발 뒤', text: '1:12.4', plain: true });
    expect(headline(frame({ hasRef: false }))).toMatchObject({ label: '비교 랩 없음', text: '—' });
    expect(headline(frame({ lapNo: 0 }))).toMatchObject({ label: '출발선을 지나면 시작', text: '—' });
    expect(headline(frame())).toMatchObject({ label: '베스트 대비', text: '+0.43', word: '느림', tone: 'slow' });
    expect(headline(frame({ delta: -0.31 }))).toMatchObject({ text: '−0.31', word: '빠름', tone: 'fast' });
  });

  it('고른 값 칸: 속도·최고 속도·랩타임·랩 번호·구간 기록', () => {
    const f = frame();
    expect(widgetValue('speed', f)).toMatchObject({ label: '속도', value: '142', unit: 'km/h' });
    expect(widgetValue('vmax', f)).toMatchObject({ value: '186', unit: 'km/h' });
    expect(widgetValue('lap', f)).toMatchObject({ value: '1:12.4' });
    expect(widgetValue('lapno', f)).toMatchObject({ value: '4', unit: '랩' });
    expect(widgetValue('sector', f)).toMatchObject({ value: 'S2 −0.19', tone: 'fast', small: true });
    expect(widgetValue('lapno', frame({ lapNo: 0 }))).toMatchObject({ value: '—', unit: '' });
  });

  it('실시간 스냅샷에서 만든다: 고스트는 코스와 비교 랩이 모두 있을 때만, 경로는 코스가 있으면 이번 랩만 (사용자 요청)', () => {
    const snap = {
      t: 5,
      state: null,
      frame: 'course' as const,
      origin: { lat: 37.2, lon: 127.1 },
      utcOffsetMs: null,
      pos: { x: 1, y: 2, psi: 0 },
      gps: { ready: true, hAcc: 4, ageMs: 100 },
      calibration: { state: 'calibrated' as const, stillProgress: 1, signsConfirmed: true, motionActive: true },
      ghost: { x: 3, y: 4, s: 10 },
      path: [[0, 0] as const, [1, 0] as const, [2, 0] as const],
      pathFrom: 1,
      pathDropped: 0,
    };
    expect(frameFromLive(snap, true, true)).toMatchObject({ hasState: false, speedKmh: 0, ghost: { x: 3, y: 4 }, path: [[1, 0], [2, 0]] });
    expect(frameFromLive(snap, true, false).ghost).toBeNull();
    expect(frameFromLive(snap, false, false)).toMatchObject({ ghost: null, path: [[0, 0], [1, 0], [2, 0]] });
    expect(frameFromLive(null, true, true)).toMatchObject({ hasState: false, speedKmh: null, me: null });
  });

  it('코스 주행 진행 (사용자 요청 "지나온 길은 코스 선을 옅게"): 랩 안이면 코스 위치 s, 랩 밖이나 코스가 없으면 없음', () => {
    const st = (p: Record<string, unknown>) => ({ t: 0, state: { lapNo: 1, lapElapsedMs: 5000, s: 120, onCourse: true, speedKmh: 40, ...p }, frame: 'course' as const, origin: null, utcOffsetMs: null, pos: null, gps: { ready: true, hAcc: 4, ageMs: 0 }, calibration: { state: 'calibrated' as const, stillProgress: 1, signsConfirmed: true, motionActive: true }, ghost: null, path: [], pathFrom: 0, pathDropped: 0 }) as never;
    expect(frameFromLive(st({}), true, false).courseS).toBe(120);
    expect(frameFromLive(st({ lapElapsedMs: null }), true, false).courseS).toBeNull();
    expect(frameFromLive(st({ s: null }), true, false).courseS).toBeNull();
    expect(frameFromLive(st({}), false, false).courseS).toBeNull();
  });
});

describe('오버레이 그리기 (캔버스)', () => {
  it('델타 패널: 라벨·느림(느림 색)·큰 델타(느림 색, 64px)·랩 번호·현재 랩', () => {
    const { ctx, texts } = fakeCtx();
    drawDeltaPanel(ctx, 358, 112, frame(), th);
    const t = texts();
    expect(t.map((x) => x.text)).toEqual(['베스트 대비', ' · ', '느림', '+0.43', '랩 4', '1:12.4']);
    expect(t.find((x) => x.text === '느림')!.color).toBe(th.slow);
    const big = t.find((x) => x.text === '+0.43')!;
    expect(big.color).toBe(th.slow);
    expect(big.font).toMatch(/600 64px/);
    expect(t.find((x) => x.text === '1:12.4')!.x).toBe(358 - 16);
  });

  it('델타 패널: 파랑·주황 설정이면 빠름은 파랑, 가로 화면은 48px', () => {
    const { ctx, texts } = fakeCtx();
    drawDeltaPanel(ctx, 380, 92, frame({ delta: -0.31 }), overlayTheme('blue-orange'), { deltaPx: 48 });
    const big = texts().find((x) => x.text === '−0.31')!;
    expect(big.color).toBe('#5cb8ff');
    expect(big.font).toMatch(/600 48px/);
  });

  it('델타 패널: 첫 주행은 경과 시간을 흰 글자로, 랩 칸 없음', () => {
    const { ctx, texts } = fakeCtx();
    drawDeltaPanel(ctx, 358, 112, frame({ hasCourse: false, hasRef: false }), th);
    expect(texts().map((x) => x.text)).toEqual(['코스 기록 중 · 출발 뒤', '1:12.4']);
    expect(texts()[1]!.color).toBe(th.fg);
  });

  it('영상 위에 그릴 때는 바탕(느림 색 테두리)까지 그린다', () => {
    const { ctx, calls } = fakeCtx();
    drawDeltaPanel(ctx, 358, 112, frame(), th, { panel: true });
    const stroke = calls.find((c) => c.op === 'stroke')!;
    expect(stroke.strokeStyle).toBe(th.slowLine);
  });

  it('값 칸: 라벨, 큰 값, 단위', () => {
    const { ctx, texts } = fakeCtx();
    drawValueTile(ctx, 170, 100, widgetValue('speed', frame()), th);
    expect(texts().map((x) => x.text)).toEqual(['속도', '142', 'km/h']);
    expect(texts()[1]!.font).toMatch(/600 40px/);
  });

  it('G 칸: 글자 없이 칸을 꽉 채운 G미터 (바깥 원 값만), 값이 없으면 점을 그리지 않는다, 임시 G는 속 빈 점', () => {
    const a = fakeCtx();
    drawGTile(a.ctx, 170, 100, frame(), th);
    expect(a.texts().map((x) => x.text)).toEqual(['2g']);
    expect(a.calls.filter((c) => c.op === 'fill').length).toBe(1);
    const outer = a.calls.filter((c) => c.op === 'arc')[1]!.args[2] as number;
    expect(outer).toBeGreaterThan(38); // 높이 100 칸에서 지름 80 넘게
    expect(gMeterLabel(frame())).toBe('G미터: 좌 0.82g, 제동 0.31g (최대 2g)');
    expect(gMeterLabel(frame({ gEstimated: true }))).toBe('G미터(추정): 좌 0.82g, 제동 0.31g (최대 2g)');
    const b = fakeCtx();
    drawGTile(b.ctx, 170, 100, frame({ gx: null, gy: null }), th);
    expect(b.calls.filter((c) => c.op === 'fill').length).toBe(0);
    const e = fakeCtx();
    drawGTile(e.ctx, 170, 100, frame({ gEstimated: true }), th);
    expect(e.calls.filter((c) => c.op === 'fill').length).toBe(0);
  });

  it('G미터 최대값(사용자 요청): 눈금 원과 점 위치가 최대값을 따르고, 최근 궤적은 곡선으로 옅게→진하게', () => {
    const arcs = (max: number, gx: number) => {
      const c = fakeCtx();
      drawGTile(c.ctx, 170, 100, frame({ gx, gy: 0, gMax: max }), th);
      return c.calls.filter((x) => x.op === 'arc').map((x) => x.args[2] as number);
    };
    // 3g면 원 1·2·3g, 점(1.5g 가속)은 가운데에서 아래로 바깥 반지름의 절반
    const three = arcs(3, 1.5);
    const R = three[2]!;
    expect(three[0]).toBeCloseTo(R / 3, 6);
    expect(three[1]).toBeCloseTo((2 * R) / 3, 6);
    const c3 = fakeCtx();
    drawGTile(c3.ctx, 170, 100, frame({ gx: 1.5, gy: 0, gMax: 3 }), th);
    const dot = c3.calls.filter((x) => x.op === 'arc').at(-1)!;
    expect((dot.args[1] as number) - 50).toBeCloseTo(R / 2, 6);
    expect(c3.texts()[0]!.text).toBe('3g');
    // 궤적
    const t = fakeCtx();
    drawGTile(t.ctx, 170, 100, frame({ gTrail: [[0, 0], [0.2, 0.1], [0.3, 0.4], [-0.31, 0.82]] }), th);
    const curves = t.calls.filter((x) => x.op === 'bezierCurveTo');
    expect(curves.length).toBe(3);
    const alphas = t.calls.filter((x) => x.op === 'stroke' && String(x.strokeStyle).startsWith('rgba(170, 202, 230')).map((x) => Number(/,\s*([\d.]+)\)$/.exec(String(x.strokeStyle))![1]));
    expect(alphas.length).toBe(3);
    expect(alphas[0]).toBeLessThan(alphas[2]!);
  });
});

describe('G미터 최대 G 점 (2026-11-20 세영 "밖으로 가면 빨간색으로 진하게, 안쪽이면 파랑색쪽으로 점선으로 찍고 연결")', () => {
  // gPeaks 가 주는 원을 도는 순서 그대로 잇는다: 가속 → 왼쪽 → 제동 → 오른쪽 → (가속)
  const peaks = [
    [0.1, 0],
    [0, 0.85],
    [-0.9, 0],
    [0, -0.15],
  ] as const;

  it('스냅숏의 최대 G 점을 화면 상태로 그대로 넘긴다', () => {
    const snap = { t: 0, state: null, frame: 'session' as const, origin: null, utcOffsetMs: null, pos: null, gps: { ready: false, hAcc: null, ageMs: null }, calibration: { state: 'need_stationary' as const, stillProgress: 0, signsConfirmed: false, motionActive: false }, ghost: null, path: [], pathFrom: 0, pathDropped: 0, gPeaks: peaks };
    expect(frameFromLive(snap, false, false).gPeaks).toBe(peaks);
    expect(frameFromLive(null, false, false).gPeaks).toBeUndefined();
  });

  it('센 쪽(왼쪽 0.85 g ↔ 제동 0.9 g)은 빨강 실선, 약한 쪽(가속 0.1 g ↔ 오른쪽 0.15 g)은 파랑 점선, 점은 모두 같은 크기', () => {
    const c = fakeCtx();
    drawGTile(c.ctx, 170, 100, frame({ gPeaks: peaks }), th);
    const segs = c.calls.filter((x) => x.op === 'stroke' && /^rgb\(/.test(String(x.strokeStyle)));
    expect(segs.length).toBe(4);
    const strong = segs[1]!; // 왼쪽 → 제동
    expect(strong.strokeStyle).toBe('rgb(255, 40, 40)');
    expect(strong.lineDash).toEqual([]);
    const weak = segs[3]!; // 오른쪽 → 가속 (닫는 선)
    expect(weak.strokeStyle).toBe('rgb(77, 163, 255)');
    expect(weak.lineDash.length).toBe(2);
    // 점: 같은 반지름 4개, 점선 없이
    const dots: number[] = [];
    c.calls.forEach((x, i) => {
      const next = c.calls[i + 1];
      if (x.op === 'arc' && next?.op === 'fill' && /^rgb\(/.test(String(next.fillStyle))) dots.push(x.args[2] as number);
    });
    expect(dots.length).toBe(4);
    expect(new Set(dots).size).toBe(1);
    // 궤적·지금 점보다 먼저 (아래에), 지금 점은 점선이 아니다
    const lastPeak = Math.max(...c.calls.map((x, i) => (/^rgb\(/.test(String(x.op === 'fill' ? x.fillStyle : x.strokeStyle)) && (x.op === 'fill' || x.op === 'stroke') ? i : -1)));
    const meDot = c.calls.findIndex((x) => x.op === 'fill' && x.fillStyle === th.fg);
    expect(lastPeak).toBeLessThan(meDot);
    expect(c.calls[meDot]!.lineDash).toEqual([]);
  });

  it('점이 없으면 아무것도 더 그리지 않는다', () => {
    const c = fakeCtx();
    drawGTile(c.ctx, 170, 100, frame({ gPeaks: [] }), th);
    expect(c.calls.filter((x) => /^rgb\(/.test(String(x.op === 'fill' ? x.fillStyle : x.strokeStyle)) && (x.op === 'fill' || x.op === 'stroke')).length).toBe(0);
  });
});

describe('상단 표시 값: 주행 거리·평균 속도 (사용자 요청 2026-11-18)', () => {
  it('주행 거리는 km 소수 한 자리, 평균 속도는 km/h. 아직 없으면 —', () => {
    expect(widgetValue('dist', frame({ distM: 23_440 }))).toMatchObject({ label: '주행 거리', value: '23.4', unit: 'km' });
    expect(widgetValue('dist', frame({ distM: 0 }))).toMatchObject({ value: '0.0', unit: 'km' });
    expect(widgetValue('dist', frame({ hasState: false, distM: undefined }))).toMatchObject({ value: '—', unit: '' });
    expect(widgetValue('avg', frame({ avgKmh: 58.4 }))).toMatchObject({ label: '평균 속도', value: '58', unit: 'km/h' });
    expect(widgetValue('avg', frame({ avgKmh: null }))).toMatchObject({ value: '—' });
  });

  it('주행 상태에서 거리·평균 속도를 가져온다', () => {
    const st = { t: 1, speedKmh: 50, distM: 1234, avgKmh: 61 } as unknown as LiveState;
    const snap = { t: 1, state: st, pos: null, path: [], pathFrom: 0, ghost: null } as unknown as Parameters<typeof frameFromLive>[0];
    expect(frameFromLive(snap, false, false)).toMatchObject({ distM: 1234, avgKmh: 61 });
  });
});

describe('미니맵 (지도 모드, 사양서 8.4)', () => {
  it('코스 전체가 아래 띠를 뺀 화면 안에 들어오고, 북쪽이 위', () => {
    const m = mapModel(course);
    expect(mapModel(course)).toBe(m); // 코스마다 한 번만 계산
    const v = fitView(m, frame(), 390, 500, { insetBottom: 120 })!;
    for (const [x, y] of m.line) {
      const [sx, sy] = v.P(x, y);
      expect(sx).toBeGreaterThanOrEqual(44 - 1e-6);
      expect(sx).toBeLessThanOrEqual(390 - 44 + 1e-6);
      expect(sy).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(sy).toBeLessThanOrEqual(500 - 44 - 120 + 1e-6);
    }
    const north = m.line[1]!; // 두 번째 점이 북쪽
    expect(v.P(north[0], north[1])[1]).toBeLessThan(v.P(m.line[0]![0], m.line[0]![1])[1]);
  });

  it('코스 선, 출발선, 고스트(점선 원 + 이름표), 내 위치 화살표를 그린다', () => {
    const { ctx, calls, texts } = fakeCtx();
    drawMiniMap(ctx, 390, 500, mapModel(course), frame(), th, { insetBottom: 120 });
    expect(texts().map((x) => x.text)).toEqual(['베스트 고스트']);
    expect(calls.some((c) => c.op === 'stroke' && c.lineDash.join() === '3,2')).toBe(true);
    // 내 위치: 기본은 큰 흰 화살표(검은 테두리, 사용자 요청 시안 A)
    expect(calls.some((c) => c.op === 'fill' && c.fillStyle === ME_MARKER.arrow.body)).toBe(true);
    expect(calls.some((c) => c.op === 'stroke' && c.strokeStyle === ME_MARKER.arrow.edge)).toBe(true);
  });

  it('고스트가 없으면 이름표도 없고, 코스가 없으면 지나온 경로를 그린다', () => {
    const a = fakeCtx();
    drawMiniMap(a.ctx, 390, 500, mapModel(course), frame({ ghost: null }), th);
    expect(a.texts()).toEqual([]);
    const b = fakeCtx();
    const path = [[0, 0], [30, 0], [60, 10]] as const;
    const v = drawMiniMap(b.ctx, 390, 500, mapModel(null), frame({ ghost: null, path, me: { x: 60, y: 10 } }), th);
    expect(v).not.toBeNull();
    expect(b.calls.filter((c) => c.op === 'lineTo').length).toBeGreaterThanOrEqual(2);
  });
});

describe('지도 선 (사용자 요청 "빨간 지나온 길은 처음 기록할 때만, 코스 주행은 지나온 코스 선을 옅게")', () => {
  const styles = (calls: Array<{ op: string; strokeStyle: unknown }>) => new Set(calls.filter((c) => c.op === 'stroke').map((c) => String(c.strokeStyle)));
  const path = [[0, 0], [0, 50], [0, 100]] as const;

  it('코스 주행: 빨간 지나온 길 없음. 지나온 코스 선은 옅게, 남은 코스 선은 밝게(하얀 테두리)', () => {
    const { ctx, calls } = fakeCtx();
    drawMiniMap(ctx, 390, 500, mapModel(course), frame({ ghost: null, path, courseS: 60 }), th);
    const used = styles(calls);
    expect(used.has(PATH_STYLE.line)).toBe(false);
    expect(used.has(PATH_STYLE.glow)).toBe(false);
    expect(used.has(COURSE_DONE.line)).toBe(true);
    expect(used.has(COURSE_LINE.line)).toBe(true);
    expect(used.has(COURSE_LINE.outline)).toBe(true);
  });

  it('코스 주행인데 아직 랩 전이면 코스 선 전체가 밝게', () => {
    const { ctx, calls } = fakeCtx();
    drawMiniMap(ctx, 390, 500, mapModel(course), frame({ ghost: null, path, courseS: null }), th);
    expect(styles(calls).has(COURSE_DONE.line)).toBe(false);
    expect(styles(calls).has(PATH_STYLE.line)).toBe(false);
  });

  it('목적지 주행: 지나온 경로 선은 그리지 않고 내 위치부터 앞쪽만 (사용자 요청 "경로대로 가면 지나온 경로는 지워져야")', () => {
    const { ctx, calls } = fakeCtx();
    const route = { line: [[0, 0], [0, 50], [0, 100]] as XY[], loop: false, start: null, finish: null };
    const view = { P: (x: number, y: number) => [x, y] as [number, number], rot: 0 };
    drawMiniMap(ctx, 390, 500, route, frame({ ghost: null, me: null, routeS: 60 }), th, { view });
    const pts = calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => (c.args as number[]).join());
    expect(pts).toContain('0,60');
    expect(pts).not.toContain('0,0');
    expect(pts).not.toContain('0,50');
    expect(styles(calls).has(COURSE_DONE.line)).toBe(false);
    expect(styles(calls).has(COURSE_LINE.line)).toBe(true);
  });

  it('목적지 주행 진행 거리: 이탈 중(s 없음)에는 마지막 값, 다시 찾아 경로가 바뀌면 처음부터', () => {
    const g1 = {};
    const g2 = {};
    let k = routeDoneS(null, g1, 120);
    expect(k).toEqual({ guide: g1, s: 120 });
    k = routeDoneS(k, g1, null);
    expect(k?.s).toBe(120);
    k = routeDoneS(k, g1, 180);
    expect(k?.s).toBe(180);
    expect(routeDoneS(k, g2, null)).toBeNull();
    expect(routeDoneS(k, g2, 5)).toEqual({ guide: g2, s: 5 });
  });

  it('처음 기록(코스 없음): 빨간 지나온 길 그대로', () => {
    const { ctx, calls } = fakeCtx();
    drawMiniMap(ctx, 390, 500, mapModel(null), frame({ ghost: null, path, me: { x: 0, y: 100 } }), th);
    expect(styles(calls).has(PATH_STYLE.line)).toBe(true);
  });
});

describe('내 차 표시 (사용자 요청 "내 차 너무 작아서 안 보여", 시안 2026-11-17)', () => {
  // 화면 좌표 = 평면 좌표 (내 위치 0,0 이 화면 0,0)
  const view = { P: (x: number, y: number) => [x, y] as [number, number], rot: 0 };
  const fills = (kind?: 'arrow' | 'white' | 'blue' | 'red', me: OverlayFrame['me'] = { x: 0, y: 0, psi: 0.5 }) => {
    const { ctx, calls } = fakeCtx();
    drawMiniMap(ctx, 390, 500, { line: [], loop: false, start: null, finish: null }, frame({ ghost: null, me }), th, kind ? { marker: kind, view } : { view });
    return { fill: new Set(calls.filter((c) => c.op === 'fill').map((c) => String(c.fillStyle))), calls };
  };

  it('화살표·흰 차·파란 점·빨간 차를 각자의 색으로 그린다 (기본 화살표)', () => {
    expect(fills().fill.has(ME_MARKER.arrow.body)).toBe(true);
    expect(fills('white').fill.has(ME_MARKER.white.body)).toBe(true);
    expect(fills('blue').fill.has(ME_MARKER.blue.body)).toBe(true);
    expect(fills('red').fill.has(ME_MARKER.red.body)).toBe(true);
    expect(fills('red').fill.has(ME_MARKER.white.body)).toBe(false);
  });

  it('예전 작은 화살표보다 크다 (그림의 가장 먼 끝이 지금 위치에서 20 px 넘게)', () => {
    for (const k of ['arrow', 'white', 'red'] as const) {
      const { calls } = fills(k, { x: 0, y: 0, psi: Math.PI / 2 });
      const far = Math.max(...calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => Math.abs((c.args as number[])[1]!)));
      expect(far).toBeGreaterThan(20);
    }
  });

  it('설정 화면 미리보기: 칸 가운데에 그 모양을 그린다', () => {
    const { ctx, calls } = fakeCtx();
    drawMeIcon(ctx, 64, 64, 'red');
    expect(calls.some((c) => c.op === 'fill' && c.fillStyle === ME_MARKER.red.body)).toBe(true);
    expect((calls.find((c) => c.op === 'translate')!.args as number[])[0]).toBe(32);
  });

  it('진행 방향을 모르면 방향 없는 큰 점 (같은 색)', () => {
    const { fill, calls } = fills('red', { x: 0, y: 0 });
    expect(fill.has(ME_MARKER.red.body)).toBe(true);
    expect(calls.some((c) => c.op === 'rotate')).toBe(false);
  });
});

describe('내 바이크 표시 (2026-11-18 바이크 모드 시안)', () => {
  const view = { P: (x: number, y: number) => [x, y] as [number, number], rot: 0 };
  const draw = (kind: BikeMarker, me: OverlayFrame['me'] = { x: 0, y: 0, psi: 0.5 }) => {
    const { ctx, calls } = fakeCtx();
    drawMiniMap(ctx, 390, 500, { line: [], loop: false, start: null, finish: null }, frame({ ghost: null, me }), th, { marker: kind, view });
    return { fill: new Set(calls.filter((c) => c.op === 'fill').map((c) => String(c.fillStyle))), calls };
  };

  it('스쿠터·R차·크루저·네이키드·모타드를 각자의 색으로, 헬멧(흰색)과 함께 진행 방향으로 돌려 그린다', () => {
    for (const k of ['scooter', 'sport', 'cruiser', 'naked', 'motard'] as const) {
      const { fill, calls } = draw(k);
      expect(fill.has(BIKE_MARK[k].body)).toBe(true);
      expect(fill.has('#f2f4f6')).toBe(true);
      for (const o of Object.keys(BIKE_MARK) as BikeMarker[]) if (o !== k) expect(fill.has(BIKE_MARK[o].body)).toBe(false);
      expect(calls.some((c) => c.op === 'rotate')).toBe(true);
    }
  });

  it('차 표시와 비슷한 크기 (바탕 원 반지름 30 px 안팎)', () => {
    const { calls } = draw('sport');
    const r = calls.filter((c) => c.op === 'arc').map((c) => (c.args as number[])[2]!);
    expect(Math.max(...r)).toBeGreaterThan(30);
    expect(Math.max(...r)).toBeLessThan(40);
  });

  it('설정 화면 미리보기도 그린다', () => {
    const { ctx, calls } = fakeCtx();
    drawMeIcon(ctx, 64, 64, 'naked');
    expect(calls.some((c) => c.op === 'fill' && c.fillStyle === BIKE_MARK.naked.body)).toBe(true);
  });

  it('진행 방향을 모르면 돌리지 않고 위를 보게', () => {
    const { fill, calls } = draw('motard', { x: 0, y: 0 });
    expect(fill.has(BIKE_MARK.motard.body)).toBe(true);
    expect(calls.some((c) => c.op === 'rotate')).toBe(false);
  });
});

describe('내 위치 자리 (사용자 요청 "더 아래로, 앞쪽 경로가 더 잘 보이게")', () => {
  it('나를 가운데·진행 방향 위: 가려지지 않은 영역의 위에서 75% 자리', () => {
    expect(ME_ANCHOR).toBe(0.75);
    const me = { x: 100, y: 50, psi: 0 };
    // 위 100 px, 아래 120 px 가림 → 보이는 영역 280 px → 100 + 210
    const v = followView(me, 390, 500, { spanM: 300, insetBottom: 120, top: 100, anchor: ME_ANCHOR });
    expect(v.P(100, 50)).toEqual([195, 310]);
  });

  it('선 지도 카메라 여백: 여백 안 가운데가 같은 75% 자리', () => {
    const pad = anchorPadding({ top: 100, bottom: 120 }, 500, ME_ANCHOR);
    expect(pad).toEqual({ top: 240, bottom: 120 });
    expect((pad.top + (500 - pad.bottom)) / 2).toBe(310);
  });
});

describe('앞 친구 간격 (M9): 델타 자리에 목표와의 차이', () => {
  const gap = (gapS: number | null, stale = false) => ({ nickname: '지훈', targetS: 2, gapS, stale });
  it('목표보다 가까우면 빨강 "가까움", 멀면 초록 "멂", 0.2초 안이면 "유지"', () => {
    expect(headline(frame({ gap: gap(1.5) }))).toMatchObject({ label: 'Delta (지훈)', text: '−0.5', word: '가까움', tone: 'slow' });
    expect(headline(frame({ gap: gap(2.64) }))).toMatchObject({ text: '+0.6', word: '멂', tone: 'fast' });
    expect(headline(frame({ gap: gap(2.1) }))).toMatchObject({ text: '+0.1', word: '유지', tone: 'none' });
    expect(headline(frame({ gap: gap(null) }))).toMatchObject({ text: '—' });
    expect(headline(frame({ gap: gap(2, true) }))).toMatchObject({ label: 'Delta (지훈) · 신호 없음', text: '—' });
  });

  it('패널 (사용자 요청): 제목 "Delta (지훈)", 오른쪽에 목표 간격과 지금 간격. 내 기록 델타는 안 보인다. 상단 칸 "앞 친구 간격"', () => {
    const { ctx, texts } = fakeCtx();
    drawDeltaPanel(ctx, 358, 112, frame({ gap: gap(1.5) }), th);
    const t = texts().map((x) => x.text);
    expect(t).toEqual(['Delta (지훈)', ' · ', '가까움', '−0.5', '목표 2.0초', '1.5초']);
    expect(texts().find((x) => x.text === '−0.5')!.color).toBe(th.slow);
    expect(widgetValue('gap', frame({ gap: gap(2.44) }))).toMatchObject({ label: '앞 친구 간격', value: '2.4', unit: '초' });
    expect(widgetValue('gap', frame({ gap: gap(2.44, true) }))).toMatchObject({ value: '—', unit: '' });
  });

  it('미니맵에 앞 친구 점과 닉네임', () => {
    const { ctx, texts } = fakeCtx();
    drawMiniMap(ctx, 390, 500, mapModel(course), frame({ ghost: null }), th, { friend: { x: 30, y: 40, label: '지훈' } });
    expect(texts().map((x) => x.text)).toEqual(['지훈']);
  });

  it('주행 지도에 위치를 공유 중인 친구들도 점과 닉네임 (사용자 요청)', () => {
    const { ctx, texts, calls } = fakeCtx();
    drawMiniMap(ctx, 390, 500, mapModel(course), frame({ ghost: null }), th, { friend: { x: 30, y: 40, label: '지훈' }, friends: [{ x: 10, y: 0, label: '남' }, { x: -20, y: 5, label: '수아' }] });
    expect(texts().map((x) => x.text).sort()).toEqual(['남', '수아', '지훈']);
    expect(calls.filter((c) => c.op === 'fill' && c.fillStyle === th.friend).length).toBeGreaterThanOrEqual(3);
  });

  it('그룹 주행: 사람마다 색 점 안에 순서 번호, 이름표도 그 색 (사용자 요청 "컬러도 모두 다르게")', () => {
    const { ctx, texts, calls } = fakeCtx();
    drawMiniMap(ctx, 390, 500, mapModel(course), frame({ ghost: null }), th, { friend: { x: 30, y: 40, label: '친구1', color: '#ff9f43', no: 1 }, friends: [{ x: 10, y: 0, label: '친구3', color: '#2ecc71', no: 3 }] });
    expect(texts().map((x) => x.text).sort()).toEqual(['1', '3', '친구1', '친구3']);
    expect(calls.some((c) => c.op === 'fill' && c.fillStyle === '#ff9f43')).toBe(true);
    expect(calls.some((c) => c.op === 'fill' && c.fillStyle === '#2ecc71')).toBe(true);
  });

  it('나를 가운데 (사용자 요청): 내 위치는 아래 띠를 뺀 화면 가운데, 북쪽 위. 보이는 거리는 화면 너비', () => {
    const me = { x: 100, y: 50, psi: 0 };
    const v = followView(me, 390, 500, { spanM: 300, insetBottom: 120 });
    expect(v.P(100, 50)).toEqual([195, 190]);
    expect(v.P(100, 60)[1]).toBeLessThan(190); // 북쪽은 위
    expect(v.P(250, 50)[0]).toBeCloseTo(390, 6); // 150 m 동쪽 = 오른쪽 끝
    expect(v.rot).toBe(0);
  });

  it('진행 방향 위 (사용자 요청): 진행 방향이 늘 화면 위, 화살표도 위, 북쪽 나침반', () => {
    const psi = 0.3; // 동쪽에서 반시계 17°
    const me = { x: 0, y: 0, psi };
    const v = followView(me, 390, 500, { spanM: 300, insetBottom: 120, headingUp: psi });
    const ahead = v.P(Math.cos(psi) * 50, Math.sin(psi) * 50);
    expect(ahead[0]).toBeCloseTo(195, 6);
    expect(ahead[1]).toBeLessThan(190);
    const { ctx, calls, texts } = fakeCtx();
    drawMiniMap(ctx, 390, 500, mapModel(course), frame({ me, ghost: null }), th, { view: v, insetBottom: 120 });
    expect(texts().map((t) => t.text)).toContain('N');
    // 내 화살표: 내 자리로 옮겨 돌리지 않고(= 위) 그린다, 꼭짓점은 위쪽
    const at = calls.filter((c) => c.op === 'translate').at(-1)!;
    expect(at.args[0] as number).toBeCloseTo(195, 6);
    expect(at.args[1] as number).toBeCloseTo(v.P(0, 0)[1], 6);
    const turn = calls.filter((c) => c.op === 'rotate').at(-1)!;
    expect(Math.abs(Math.sin(turn.args[0] as number))).toBeLessThan(1e-9);
    expect(Math.cos(turn.args[0] as number)).toBeGreaterThan(0);
    const tip = calls.filter((c) => c.op === 'moveTo').at(-1)!;
    expect(tip.args[1] as number).toBeLessThan(-10);
  });
});
