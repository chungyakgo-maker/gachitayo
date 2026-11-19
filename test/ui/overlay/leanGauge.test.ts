// 바이크 기울기 칸 그리기 (2026-11-18 시안 docs/mock/2026-11-18-lean.jpg: 바늘·숫자·호, 왼쪽 파랑·오른쪽 빨강)
import { describe, expect, it } from 'vitest';
import { fakeCtx } from './fakeCtx';
import { drawLeanTile, LEAN_COLOR, leanLabel } from '../../../src/ui/overlay/leanGauge';
import { overlayTheme } from '../../../src/ui/overlay/theme';

const th = overlayTheme('green-red');
const draw = (leanDeg: number | null, maxL = 0, maxR = 0, hasState = true) => {
  const f = fakeCtx();
  drawLeanTile(f.ctx, 176, 100, { hasState, leanDeg, maxLeanLeftDeg: maxL, maxLeanRightDeg: maxR }, th);
  return f;
};

describe('기울기 칸', () => {
  it('왼쪽이면 파랑으로 숫자·"왼쪽", 오른쪽이면 빨강', () => {
    const l = draw(-32.4, 41, 38);
    expect(l.texts()).toContainEqual(expect.objectContaining({ text: '32°', color: LEAN_COLOR.left }));
    expect(l.texts()).toContainEqual(expect.objectContaining({ text: '왼쪽', color: LEAN_COLOR.left }));
    expect(l.texts().map((t) => t.text)).toEqual(expect.arrayContaining(['최대 왼 41°', '오른 38°']));
    const r = draw(37);
    expect(r.texts()).toContainEqual(expect.objectContaining({ text: '37°', color: LEAN_COLOR.right }));
    expect(r.texts()).toContainEqual(expect.objectContaining({ text: '오른쪽', color: LEAN_COLOR.right }));
  });

  it('똑바로면 흰 글자 0°, 왼쪽/오른쪽 글자 없음', () => {
    const z = draw(0.2);
    expect(z.texts()).toContainEqual(expect.objectContaining({ text: '0°', color: th.fg }));
    expect(z.texts().some((t) => t.text === '왼쪽' || t.text === '오른쪽')).toBe(false);
  });

  it('바늘이 각도 쪽을 가리킨다 (왼쪽이면 축보다 왼쪽 위 끝)', () => {
    const { calls } = draw(-30);
    // 바늘: 굵기 3.2 선의 끝점
    const i = calls.findIndex((c) => c.op === 'stroke' && c.strokeStyle === LEAN_COLOR.left && calls.slice(0, calls.indexOf(c)).reverse().find((x) => x.op === 'lineTo'));
    expect(i).toBeGreaterThan(-1);
    const tip = calls.slice(0, i).reverse().find((x) => x.op === 'lineTo')!.args as number[];
    expect(tip[0]).toBeLessThan(88);
    expect(tip[1]).toBeLessThan(86);
  });

  it('모르면 바늘 없이 —, 60°를 넘는 값은 60°로', () => {
    expect(draw(null, 0, 0).texts()).toContainEqual(expect.objectContaining({ text: '—' }));
    expect(draw(75).texts()).toContainEqual(expect.objectContaining({ text: '60°' }));
  });

  it('화면 읽기 글', () => {
    expect(leanLabel({ hasState: true, leanDeg: -32.4, maxLeanLeftDeg: 41, maxLeanRightDeg: 38 })).toBe('기울기 왼쪽 32도 (최대 왼쪽 41도, 오른쪽 38도)');
    expect(leanLabel({ hasState: true, leanDeg: 0, maxLeanLeftDeg: 0, maxLeanRightDeg: 0 })).toBe('기울기 0도 (최대 왼쪽 0도, 오른쪽 0도)');
    expect(leanLabel({ hasState: false, leanDeg: null })).toBe('기울기 — (최대 왼쪽 0도, 오른쪽 0도)');
  });
});

describe('기울기 칸 이름 빼기 (기울기 시험 화면: 위에 따로 제목이 있다)', () => {
  it('title: false 면 "기울기" 글자를 그리지 않는다 (기본은 그린다)', () => {
    const on = fakeCtx();
    drawLeanTile(on.ctx, 176, 100, { hasState: true, leanDeg: 10, maxLeanLeftDeg: 0, maxLeanRightDeg: 0 }, th);
    expect(on.texts().map((t) => t.text)).toContain('기울기');
    const off = fakeCtx();
    drawLeanTile(off.ctx, 176, 100, { hasState: true, leanDeg: 10, maxLeanLeftDeg: 0, maxLeanRightDeg: 0 }, th, { title: false });
    expect(off.texts().map((t) => t.text)).not.toContain('기울기');
  });
});
