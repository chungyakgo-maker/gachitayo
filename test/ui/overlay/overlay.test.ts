import { describe, expect, it } from 'vitest';
import { fakeCtx } from './fakeCtx';
import { drawDeltaPanel, drawGTile, drawValueTile, gMeterLabel } from '../../../src/ui/overlay/draw';
import { frameFromLive, headline, widgetValue, type OverlayFrame } from '../../../src/ui/overlay/frame';
import { drawMiniMap, fitView, mapModel } from '../../../src/ui/overlay/minimap';
import { overlayTheme } from '../../../src/ui/overlay/theme';
import type { Course } from '../../../src/types/course';

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

  it('실시간 스냅샷에서 만든다: 고스트는 코스와 비교 랩이 모두 있을 때만, 경로는 첫 주행에만', () => {
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
      path: [[0, 0] as const],
    };
    expect(frameFromLive(snap, true, true)).toMatchObject({ hasState: false, speedKmh: 0, ghost: { x: 3, y: 4 }, path: undefined });
    expect(frameFromLive(snap, true, false).ghost).toBeNull();
    expect(frameFromLive(snap, false, false)).toMatchObject({ ghost: null, path: [[0, 0]] });
    expect(frameFromLive(null, true, true)).toMatchObject({ hasState: false, speedKmh: null, me: null });
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

  it('G 칸: G미터 점과 "좌 0.82 / 제동 0.31", 값이 없으면 점을 그리지 않는다', () => {
    const a = fakeCtx();
    drawGTile(a.ctx, 170, 100, frame(), th);
    expect(a.texts().map((x) => x.text)).toEqual(['G', '좌 ', '0.82', '제동 ', '0.31']);
    const dots = a.calls.filter((c) => c.op === 'fill');
    expect(dots.length).toBe(1);
    expect(gMeterLabel(frame())).toBe('G미터: 좌 0.82g, 제동 0.31g');
    const b = fakeCtx();
    drawGTile(b.ctx, 170, 100, frame({ gx: null, gy: null }), th);
    expect(b.calls.filter((c) => c.op === 'fill').length).toBe(0);
    expect(b.texts().map((x) => x.text)).toContain('—');
  });
});

describe('미니맵 (지도 모드, 사양서 8.4)', () => {
  it('코스 전체가 아래 띠를 뺀 화면 안에 들어오고, 북쪽이 위', () => {
    const m = mapModel(course);
    expect(mapModel(course)).toBe(m); // 코스마다 한 번만 계산
    const v = fitView(m, frame(), 390, 500, { insetBottom: 120 })!;
    for (const [x, y] of m.line) {
      expect(v.X(x)).toBeGreaterThanOrEqual(44 - 1e-6);
      expect(v.X(x)).toBeLessThanOrEqual(390 - 44 + 1e-6);
      expect(v.Y(y)).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(v.Y(y)).toBeLessThanOrEqual(500 - 44 - 120 + 1e-6);
    }
    const north = m.line[1]!; // 두 번째 점이 북쪽
    expect(v.Y(north[1])).toBeLessThan(v.Y(m.line[0]![1]));
  });

  it('코스 선, 출발선, 고스트(점선 원 + 이름표), 내 위치 화살표를 그린다', () => {
    const { ctx, calls, texts } = fakeCtx();
    drawMiniMap(ctx, 390, 500, mapModel(course), frame(), th, { insetBottom: 120 });
    expect(texts().map((x) => x.text)).toEqual(['베스트 고스트']);
    expect(calls.some((c) => c.op === 'stroke' && c.lineDash.join() === '3,2')).toBe(true);
    // 내 위치: 화살표(채우기 + 주황 테두리)
    const last = calls.filter((c) => c.op === 'stroke').at(-1)!;
    expect(last.strokeStyle).toBe(th.accent);
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
