// 미니맵 (사양서 8.4 지도 모드, 13.1 오버레이의 미니맵): 지도 타일 없이 코스 선, 출발선(편도면 도착선),
// 내 위치 화살표, 베스트 고스트(점선 원), 지나온 경로. 코스 전체가 한 화면에 보이게 고정한다 (북쪽이 위).
import { gateSegment } from '../../engine/course/geometry';
import { toLocal } from '../../engine/geo';
import type { Course } from '../../types/course';
import { roundRect, type Ctx } from './draw';
import type { OverlayFrame, XY } from './frame';
import type { OverlayTheme } from './theme';

type Gate = ReturnType<typeof gateSegment>;

export interface MapModel {
  line: XY[];
  loop: boolean;
  start: Gate | null;
  finish: Gate | null;
}

const cache = new WeakMap<Course, MapModel>();

/** 코스 → 그리기용 평면 좌표 (코스마다 한 번 계산해 둔다) */
export function mapModel(course: Course | null): MapModel {
  if (!course) return { line: [], loop: false, start: null, finish: null };
  const hit = cache.get(course);
  if (hit) return hit;
  const m: MapModel = {
    line: (course.centerline ?? []).map(([lat, lon]) => {
      const p = toLocal(course.origin, lat, lon);
      return [p.x, p.y] as const;
    }),
    loop: course.kind === 'loop',
    start: gateSegment(course.startGate, course.origin),
    finish: course.kind === 'point_to_point' ? gateSegment(course.finishGate, course.origin) : null,
  };
  cache.set(course, m);
  return m;
}

export interface MapView {
  X: (x: number) => number;
  Y: (y: number) => number;
}

export interface MiniMapOpts {
  /** 아래쪽을 가리는 띠 높이 (px) */
  insetBottom?: number;
  /** 여백 (px). 위쪽은 top */
  margin?: number;
  top?: number;
  /** 고스트 이름표 */
  ghostLabel?: boolean;
}

/** 화면에 맞추기: 코스가 있으면 코스 전체, 없으면 지나온 경로와 내 위치 (너무 작으면 200 m 범위) */
export function fitView(model: MapModel, f: Pick<OverlayFrame, 'me' | 'path'>, w: number, h: number, opts: MiniMapOpts = {}): MapView | null {
  const pts: XY[] = model.line.length ? model.line : [...(f.path ?? []), ...(f.me ? [[f.me.x, f.me.y] as const] : [])];
  if (!model.line.length && model.start) pts.push([model.start.cx, model.start.cy]);
  if (pts.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const span = 200;
  if (maxX - minX < span) {
    const c = (minX + maxX) / 2;
    minX = c - span / 2;
    maxX = c + span / 2;
  }
  if (maxY - minY < span) {
    const c = (minY + maxY) / 2;
    minY = c - span / 2;
    maxY = c + span / 2;
  }
  const m = opts.margin ?? 44;
  const top = opts.top ?? 24;
  const aw = w - 2 * m;
  const ah = h - top - m - (opts.insetBottom ?? 0);
  const sc = Math.max(1e-6, Math.min(aw / (maxX - minX), ah / (maxY - minY)));
  const ox = m + (aw - (maxX - minX) * sc) / 2;
  const oy = top + (ah - (maxY - minY) * sc) / 2;
  return { X: (x) => ox + (x - minX) * sc, Y: (y) => oy + (maxY - y) * sc };
}

const STYLE = { wide: '#1F2327', wideW: 14, thin: '#3A3F45', gate: '#C9CDD2' };

function polyline(ctx: Ctx, pts: ReadonlyArray<XY>, v: MapView, close: boolean): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(v.X(x), v.Y(y)) : ctx.moveTo(v.X(x), v.Y(y))));
  if (close) ctx.closePath();
}

function gateLine(ctx: Ctx, g: Gate, v: MapView, dashed: boolean): void {
  const cx = v.X(g.cx);
  const cy = v.Y(g.cy);
  // 게이트 선은 진행 방향에 수직, 화면에서 ±10 px
  const nx = -g.dy;
  const ny = -g.dx;
  ctx.setLineDash(dashed ? [4, 3] : []);
  ctx.strokeStyle = STYLE.gate;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + nx * 10, cy + ny * 10);
  ctx.lineTo(cx - nx * 10, cy - ny * 10);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** 미니맵 그리기. 바탕은 호출하는 쪽이 칠한다 */
export function drawMiniMap(ctx: Ctx, w: number, h: number, model: MapModel, f: OverlayFrame, th: OverlayTheme, opts: MiniMapOpts = {}): MapView | null {
  const v = fitView(model, f, w, h, opts);
  if (!v) return null;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  if (model.line.length >= 2) {
    polyline(ctx, model.line, v, model.loop);
    ctx.strokeStyle = STYLE.wide;
    ctx.lineWidth = STYLE.wideW;
    ctx.stroke();
    ctx.strokeStyle = STYLE.thin;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  if (f.path && f.path.length >= 2) {
    polyline(ctx, f.path, v, false);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (model.start) gateLine(ctx, model.start, v, false);
  if (model.finish) gateLine(ctx, model.finish, v, true);

  if (f.ghost) {
    const x = v.X(f.ghost.x);
    const y = v.Y(f.ghost.y);
    ctx.setLineDash([3, 2]);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = th.fg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (opts.ghostLabel !== false) {
      const bw = 94;
      const cx = Math.min(Math.max(x, bw / 2 + 6), w - bw / 2 - 6);
      const cy = Math.max(18, y - 30);
      roundRect(ctx, cx - bw / 2, cy - 12, bw, 24, 12);
      ctx.fillStyle = th.tile;
      ctx.fill();
      ctx.strokeStyle = th.fgOff;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `400 12px ${th.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = th.fg2;
      ctx.fillText('베스트 고스트', cx, cy);
    }
    ctx.setLineDash([]);
  }

  if (f.me) {
    const x = v.X(f.me.x);
    const y = v.Y(f.me.y);
    ctx.fillStyle = 'rgba(255, 178, 36, 0.16)';
    ctx.beginPath();
    ctx.arc(x, y, f.me.psi !== undefined ? 15 : 16, 0, Math.PI * 2);
    ctx.fill();
    if (f.me.psi !== undefined) {
      const tx = Math.cos(f.me.psi);
      const ty = -Math.sin(f.me.psi);
      const ox = -ty;
      const oy = tx;
      ctx.beginPath();
      ctx.moveTo(x + tx * 12, y + ty * 12);
      ctx.lineTo(x - tx * 7 + ox * 7, y - ty * 7 + oy * 7);
      ctx.lineTo(x - tx * 7 - ox * 7, y - ty * 7 - oy * 7);
      ctx.closePath();
      ctx.fillStyle = th.fg;
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = th.fg;
      ctx.fill();
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  return v;
}
