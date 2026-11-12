// 오버레이 그리기 (사양서 13.1 확장 지점, 5.1의 12번): "시각 t의 상태 → 캔버스".
// 주행 화면 지도 모드가 쓰고, 나중에 영상에 입히기가 영상 프레임 위에 같은 함수를 부른다.
// 크기·글꼴은 디자인 시안(styles.css)과 같게 맞췄다. 좌표는 CSS px (호출하는 쪽이 기기 배율을 맞춘다).
import { formatDelta, formatLapTime } from '../format';
import { gLabel, headline, type OverlayFrame, type Tone, type ValueTile } from './frame';
import type { OverlayTheme } from './theme';

export type Ctx = CanvasRenderingContext2D;

const toneColor = (th: OverlayTheme, tone: Tone, fallback: string) => (tone === 'fast' ? th.fast : tone === 'slow' ? th.slow : fallback);
const toneColorOf = (th: OverlayTheme, d: number) => (d < 0 ? th.fast : d > 0 ? th.slow : th.fg2);

/** 글자 간격: 지원하는 브라우저에서만 (모르면 기본 간격) */
function setSpacing(ctx: Ctx, px: number): void {
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px.toFixed(2)}px`;
}

function setFont(ctx: Ctx, weight: number, px: number, family: string, spacingEm = 0): void {
  ctx.font = `${weight} ${px}px ${family}`;
  setSpacing(ctx, spacingEm * px);
}

/** 글자를 쓰고 끝 x를 돌려준다 */
function text(ctx: Ctx, s: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left'): number {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
  const w = ctx.measureText(s).width;
  return align === 'left' ? x + w : align === 'right' ? x - w : x;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 패널 바탕 (영상 위에 그릴 때. 주행 화면은 HTML이 바탕을 그린다) */
export function drawPanel(ctx: Ctx, w: number, h: number, th: OverlayTheme, tone: Tone, radius = 18): void {
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, radius);
  ctx.fillStyle = tone === 'fast' ? th.fastBg : tone === 'slow' ? th.slowBg : th.tile;
  ctx.fill();
  ctx.strokeStyle = tone === 'fast' ? th.fastLine : tone === 'slow' ? th.slowLine : th.cardLine;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export interface DeltaPanelOpts {
  /** 큰 델타 글자 크기 (세로 64, 가로 화면 48) */
  deltaPx?: number;
  /** 바탕을 그릴지 */
  panel?: boolean;
}

/** 델타 패널: 왼쪽 "베스트 대비 · 느림"과 큰 델타, 오른쪽 랩 번호와 현재 랩 경과 */
export function drawDeltaPanel(ctx: Ctx, w: number, h: number, f: OverlayFrame, th: OverlayTheme, opts: DeltaPanelOpts = {}): void {
  const hl = headline(f);
  const big = opts.deltaPx ?? 64;
  if (opts.panel) drawPanel(ctx, w, h, th, hl.tone);
  const padX = 16;
  const labelH = 17;
  const top = (h - (labelH + big)) / 2;
  ctx.textBaseline = 'middle';
  // 첫 줄: 라벨 · 빠름/느림
  // 위치는 시안(HTML) 화면과 겹쳐 보며 맞춘 값이다. 'middle' 기준선은 숫자 모양의 가운데보다 조금 위라 아래로 보정한다
  const labelY = top + labelH / 2 - 2.5;
  setFont(ctx, 400, 13, th.sans);
  let x = text(ctx, hl.label, padX, labelY, th.fg2);
  if (hl.word) {
    x = text(ctx, ' · ', x, labelY, th.fg2);
    setFont(ctx, 700, 13, th.sans);
    text(ctx, hl.word, x, labelY, toneColor(th, hl.tone, th.fg2));
  }
  // 큰 델타
  setFont(ctx, 600, big, th.mono, -0.05);
  text(ctx, hl.text, padX, top + labelH + big / 2 + big * 0.13, hl.plain ? th.fg : toneColor(th, hl.tone, th.fg2));
  // 오른쪽: 앞 친구 간격이면 지금 간격과 작은 베스트 대비 델타, 아니면 랩 번호와 현재 랩 경과
  if (f.gap) {
    const rx = w - padX;
    setFont(ctx, 400, 12, th.sans);
    text(ctx, '지금 간격', rx, h / 2 - 17.5, th.fgDim, 'right');
    setFont(ctx, 500, 24, th.mono);
    const g = f.gap;
    text(ctx, !g.stale && g.gapS !== null ? `${g.gapS.toFixed(1)}초` : '—', rx, h / 2 + 14.5, th.fg, 'right');
    if (f.hasCourse && f.hasRef && f.hasState && f.lapNo > 0 && f.delta !== null) {
      setFont(ctx, 400, 12, th.sans);
      text(ctx, `베스트 ${formatDelta(f.delta)}`, rx, h - 12, toneColorOf(th, f.delta), 'right');
    }
  } else if (f.hasCourse) {
    const lap = f.hasState && f.lapNo > 0 ? `랩 ${f.lapNo}` : '랩';
    const rx = w - padX;
    setFont(ctx, 400, 12, th.sans);
    text(ctx, lap, rx, h / 2 - 17.5, th.fgDim, 'right');
    setFont(ctx, 500, 24, th.mono);
    text(ctx, formatLapTime(f.lapElapsedMs, 1), rx, h / 2 + 14.5, th.fg, 'right');
  }
  setSpacing(ctx, 0);
}

/** 값 한 칸: 위에 라벨, 아래에 큰 값과 단위 (높이 100 기준) */
export function drawValueTile(ctx: Ctx, w: number, h: number, v: ValueTile, th: OverlayTheme, opts: { panel?: boolean } = {}): void {
  if (opts.panel) drawPanel(ctx, w, h, th, 'none', 16);
  const padX = 14;
  const padY = 12;
  ctx.textBaseline = 'middle';
  setFont(ctx, 400, 12, th.sans);
  text(ctx, v.label, padX, padY + 10, th.fgDim);
  const px = v.small ? 30 : 40;
  ctx.textBaseline = 'alphabetic';
  setFont(ctx, 600, px, th.mono, -0.04);
  const base = h - padY - px * 0.2 + 2.5;
  const end = text(ctx, v.value, padX, base, toneColor(th, v.tone, th.fg));
  if (v.unit) {
    setFont(ctx, 400, 13, th.sans);
    text(ctx, v.unit, end + 6, base, th.fgDim);
  }
  setSpacing(ctx, 0);
}

/** G미터: 원 안에서 움직이는 점. 바깥 원 1 g, 안쪽 원 0.5 g. 위가 제동, 왼쪽이 좌 (사양서 8.4) */
export function drawGMeter(ctx: Ctx, cx: number, cy: number, size: number, gx: number | null, gy: number | null, th: OverlayTheme): void {
  const big = size >= 100;
  const R = size * (big ? 52 / 124 : 28 / 64);
  const clamp = (v: number) => Math.max(-1.2, Math.min(1.2, v));
  const dx = gy === null ? 0 : -clamp(gy) * R;
  const dy = gx === null ? 0 : clamp(gx) * R;
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#3A3F45';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#2A2E33';
  ctx.beginPath();
  ctx.arc(cx, cy, R / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#22262B';
  ctx.beginPath();
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx, cy + R);
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.stroke();
  if (big) {
    ctx.textBaseline = 'top';
    setFont(ctx, 400, 9, th.sans);
    text(ctx, '제동', cx, cy - size / 2 + 2, '#8A9199', 'center');
    ctx.textBaseline = 'middle';
    text(ctx, '좌', cx - size / 2 + 2, cy, '#8A9199');
    ctx.strokeStyle = 'rgba(236, 238, 240, 0.35)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
  }
  if (gx !== null && gy !== null) {
    ctx.fillStyle = th.fg;
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, big ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** G 칸: 왼쪽 G미터(64), 오른쪽 "G / 좌 0.80 / 제동 0.00" */
export function drawGTile(ctx: Ctx, w: number, h: number, f: OverlayFrame, th: OverlayTheme, opts: { panel?: boolean } = {}): void {
  if (opts.panel) drawPanel(ctx, w, h, th, 'none', 16);
  const size = 64;
  drawGMeter(ctx, 12 + size / 2, h / 2, size, f.gx, f.gy, th);
  const l = gLabel(f.gx, f.gy);
  const x0 = 12 + size + 10;
  const lines = 15 + 2 + 18 + 2 + 18;
  const top = (h - lines) / 2;
  ctx.textBaseline = 'middle';
  setFont(ctx, 400, 12, th.sans);
  text(ctx, 'G', x0, top + 7.5, th.fgDim);
  const row = (y: number, word: string, val: string) => {
    setFont(ctx, 400, 13, th.sans);
    const x = text(ctx, `${word} `, x0, y, th.fg2);
    setFont(ctx, 400, 13, th.mono);
    text(ctx, val, x, y, th.fg);
  };
  row(top + 28, l.lat, l.latV);
  row(top + 49, l.long, l.longV);
}

export const gMeterLabel = (f: Pick<OverlayFrame, 'gx' | 'gy'>) => {
  const l = gLabel(f.gx, f.gy);
  return `G미터: ${l.lat} ${l.latV}g, ${l.long} ${l.longV}g`;
};
