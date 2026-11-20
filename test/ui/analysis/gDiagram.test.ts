// 분석 G 다이어그램에 최대 G 점·선 (2026-11-20 세영 "분석에 있는 G-force는 왜 그대로?" → 시안 docs/mock/2026-11-20-gpeaks-analysis.jpg → "진행"):
// 고른 랩의 방향별 최대 G 를 주행 화면 G미터와 같은 모양으로, 하늘색 점들 위·고른 지점(흰 점) 아래에
import { describe, expect, it } from 'vitest';
import { fakeCtx } from '../overlay/fakeCtx';
import { drawGDiagram } from '../../../src/ui/analysis/GDiagram';
import type { ProcessedTrack } from '../../../src/engine/process/processDrive';

const MS2 = 9.80665;
/** 10 Hz 처리된 궤적: 랩 1 은 세게(제동 0.9 g → 왼쪽 0.85 g → 가속 0.3 g), 랩 2 는 살살(모두 0.2 g) */
function track(): ProcessedTrack {
  const rows: Array<[number, number, number]> = [];
  const hold = (lap: number, gx: number, gy: number, n = 10) => {
    for (let i = 0; i < n; i++) rows.push([lap, gx * MS2, gy * MS2]);
  };
  hold(1, -0.9, 0);
  hold(1, 0, 0.85);
  hold(1, 0.3, 0);
  hold(2, -0.2, 0);
  hold(2, 0, 0.2);
  hold(2, 0.2, 0);
  return { n: rows.length, t: rows.map((_, i) => i * 100), lapNo: rows.map((r) => r[0]), ax: rows.map((r) => r[1]), ay: rows.map((r) => r[2]) } as unknown as ProcessedTrack;
}
const isPeak = (c: { op: string; strokeStyle: unknown; fillStyle: unknown }) =>
  (c.op === 'stroke' && /^rgb\(/.test(String(c.strokeStyle))) || (c.op === 'fill' && /^rgb\(/.test(String(c.fillStyle)));

describe('분석 G 다이어그램의 최대 G 점·선', () => {
  it('세게 쓴 랩: 빨강 실선이 있고, 하늘색 점들 뒤·고른 지점(흰 점) 앞에 그린다', () => {
    const p = track();
    const f = fakeCtx();
    drawGDiagram(f.ctx, 360, 260, { p, lapNo: 1, selected: 15, max: 2 });
    const peaks = f.calls.map((c, i) => (isPeak(c) ? i : -1)).filter((i) => i >= 0);
    expect(peaks.length).toBeGreaterThan(0);
    const red = f.calls.filter((c) => c.op === 'stroke' && c.strokeStyle === 'rgb(255, 40, 40)');
    expect(red.length).toBeGreaterThan(0);
    expect(red.every((c) => c.lineDash.length === 0)).toBe(true);
    const lastScatter = f.calls.map((c, i) => (c.op === 'fillRect' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const white = f.calls.findIndex((c) => c.op === 'fill' && c.fillStyle === '#eceef0');
    expect(lastScatter).toBeGreaterThan(-1);
    expect(Math.min(...peaks)).toBeGreaterThan(lastScatter);
    expect(Math.max(...peaks)).toBeLessThan(white);
    expect(f.calls[white]!.lineDash).toEqual([]);
  });

  it('랩을 바꾸면 그 랩의 선: 살살 달린 랩은 파랑 점선뿐', () => {
    const f = fakeCtx();
    drawGDiagram(f.ctx, 360, 260, { p: track(), lapNo: 2, selected: null, max: 2 });
    const strokes = f.calls.filter((c) => c.op === 'stroke' && /^rgb\(/.test(String(c.strokeStyle)));
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every((c) => c.strokeStyle === 'rgb(77, 163, 255)' && c.lineDash.length === 2)).toBe(true);
  });

  it('그 랩에 G 가 없으면(보정 전 기록) 선도 없다', () => {
    const p = { ...track(), ax: track().ax.map(() => null), ay: track().ay.map(() => null) } as ProcessedTrack;
    const f = fakeCtx();
    drawGDiagram(f.ctx, 360, 260, { p, lapNo: 1, selected: null, max: 2 });
    expect(f.calls.filter(isPeak).length).toBe(0);
  });
});
