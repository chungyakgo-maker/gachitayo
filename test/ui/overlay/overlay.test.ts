import { describe, expect, it } from 'vitest';
import { fakeCtx } from './fakeCtx';
import { drawDeltaPanel, drawGTile, drawValueTile, gMeterLabel } from '../../../src/ui/overlay/draw';
import { frameFromLive, headline, widgetValue, type OverlayFrame } from '../../../src/ui/overlay/frame';
import { drawMiniMap, fitView, followView, mapModel } from '../../../src/ui/overlay/minimap';
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

describe('앞 친구 간격 (M9): 델타 자리에 목표와의 차이', () => {
  const gap = (gapS: number | null, stale = false) => ({ nickname: '지훈', targetS: 2, gapS, stale });
  it('목표보다 가까우면 빨강 "가까움", 멀면 초록 "멂", 0.2초 안이면 "유지"', () => {
    expect(headline(frame({ gap: gap(1.5) }))).toMatchObject({ label: '앞 지훈 · 목표 2.0초', text: '−0.5', word: '가까움', tone: 'slow' });
    expect(headline(frame({ gap: gap(2.64) }))).toMatchObject({ text: '+0.6', word: '멂', tone: 'fast' });
    expect(headline(frame({ gap: gap(2.1) }))).toMatchObject({ text: '+0.1', word: '유지', tone: 'none' });
    expect(headline(frame({ gap: gap(null) }))).toMatchObject({ text: '—' });
    expect(headline(frame({ gap: gap(2, true) }))).toMatchObject({ label: '앞 지훈 · 신호 없음', text: '—' });
  });

  it('패널 오른쪽: 지금 간격, 아래에 작게 베스트 대비 델타. 상단 칸 "앞 친구 간격"', () => {
    const { ctx, texts } = fakeCtx();
    drawDeltaPanel(ctx, 358, 112, frame({ gap: gap(1.5) }), th);
    const t = texts().map((x) => x.text);
    expect(t).toEqual(['앞 지훈 · 목표 2.0초', ' · ', '가까움', '−0.5', '지금 간격', '1.5초', '베스트 +0.43']);
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
    // 내 화살표 꼭짓점이 위쪽 (moveTo y < 중심)
    const tip = calls.filter((c) => c.op === 'moveTo').at(-1)!;
    expect(tip.args[1] as number).toBeLessThan(190 - 10);
    expect(tip.args[0] as number).toBeCloseTo(195, 6);
  });
});
