// 미니맵 (사양서 8.4 지도 모드, 13.1 오버레이의 미니맵): 지도 타일 없이 코스 선, 출발선(편도면 도착선),
// 내 위치 화살표, 베스트 고스트(점선 원), 지나온 경로.
// 보기 (사용자 요청): 전체 코스(한 화면에, 북쪽 위) / 나를 가운데(북쪽 위) / 진행 방향 위(내비처럼 지도가 돈다).
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

/** 평면 좌표(m) → 화면 좌표(px). rot: 지도를 돌린 각도(라디안, 반시계). 방향(화살표·게이트)을 같이 돌릴 때 쓴다 */
export interface MapView {
  P: (x: number, y: number) => [number, number];
  rot: number;
}

export type { MapViewMode } from '../../app/settings';

/** 나를 가운데 두는 보기: span = 화면 너비에 보일 거리(m), psi = 진행 방향(진행 방향 위일 때) */
export function followView(me: { x: number; y: number }, w: number, h: number, opts: { spanM: number; insetBottom?: number; top?: number; headingUp?: number | null }): MapView {
  const top = opts.top ?? 0;
  const cx = w / 2;
  const cy = (top + h - (opts.insetBottom ?? 0)) / 2;
  const sc = w / Math.max(50, opts.spanM);
  // 진행 방향을 위(북쪽 자리)로: π/2 − psi 만큼 돌린다
  const rot = opts.headingUp === null || opts.headingUp === undefined ? 0 : Math.PI / 2 - opts.headingUp;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return {
    rot,
    P: (x, y) => {
      const dx = x - me.x;
      const dy = y - me.y;
      return [cx + (dx * c - dy * s) * sc, cy - (dx * s + dy * c) * sc];
    },
  };
}

/** 세계 방향(dx, dy, 북쪽 위 y) → 돌린 화면 방향 (y는 아래로) */
const screenDir = (v: MapView, dx: number, dy: number): [number, number] => {
  const c = Math.cos(v.rot);
  const s = Math.sin(v.rot);
  return [dx * c - dy * s, -(dx * s + dy * c)];
};

export interface MiniMapOpts {
  /** 아래쪽을 가리는 띠 높이 (px) */
  insetBottom?: number;
  /** 여백 (px). 위쪽은 top */
  margin?: number;
  top?: number;
  /** 고스트 이름표 */
  ghostLabel?: boolean;
  /** 바깥에서 정한 좌표 변환 (재생 모드에서 지도 타일 위에 그릴 때) */
  view?: MapView;
  /** 함께 그릴 앞 친구 위치 (같은 평면 좌표) */
  friend?: { x: number; y: number; label: string } | null;
  /** 위치를 공유 중인 다른 친구들 (주행 중, 사용자 요청) */
  friends?: ReadonlyArray<{ x: number; y: number; label: string }>;
  /** 돌린 지도에서 왼쪽 위 작은 나침반 (주행 화면은 나침반 버튼이 대신하므로 끈다) */
  north?: boolean;
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
  return { rot: 0, P: (x, y) => [ox + (x - minX) * sc, oy + (maxY - y) * sc] };
}

const STYLE = { wide: '#1F2327', wideW: 14, thin: '#3A3F45', gate: '#C9CDD2' };

function polyline(ctx: Ctx, pts: ReadonlyArray<XY>, v: MapView, close: boolean): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const [sx, sy] = v.P(x, y);
    if (i) ctx.lineTo(sx, sy);
    else ctx.moveTo(sx, sy);
  });
  if (close) ctx.closePath();
}

function gateLine(ctx: Ctx, g: Gate, v: MapView, dashed: boolean): void {
  const [cx, cy] = v.P(g.cx, g.cy);
  // 게이트 선은 진행 방향에 수직, 화면에서 ±10 px
  const [tx, ty] = screenDir(v, g.dx, g.dy);
  const nx = -ty;
  const ny = tx;
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

/** 지나온 길 색 (코스 지도의 빨간 선과 같게) */
export const PATH_STYLE = { glow: '#ff3b30', line: '#ff453a', highlight: '#ffd2ce' } as const;

/** 미니맵 그리기. 바탕은 호출하는 쪽이 칠한다 */
export function drawMiniMap(ctx: Ctx, w: number, h: number, model: MapModel, f: OverlayFrame, th: OverlayTheme, opts: MiniMapOpts = {}): MapView | null {
  const v = opts.view ?? fitView(model, f, w, h, opts);
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
    // 지나온 길: 코스 지도와 같은 빨간 선 + 빛 번짐 (사용자 요청 "너무 옅어서 안 보인다")
    polyline(ctx, f.path, v, false);
    ctx.strokeStyle = PATH_STYLE.glow;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 14;
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PATH_STYLE.line;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = PATH_STYLE.highlight;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (model.start) gateLine(ctx, model.start, v, false);
  if (model.finish) gateLine(ctx, model.finish, v, true);

  if (f.ghost) {
    const [x, y] = v.P(f.ghost.x, f.ghost.y);
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

  for (const fp of [...(opts.friends ?? []), ...(opts.friend ? [opts.friend] : [])]) {
    const [x, y] = v.P(fp.x, fp.y);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = th.friend;
    ctx.fill();
    ctx.strokeStyle = '#0d0e10';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `700 12px ${th.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = th.friend;
    ctx.fillText(fp.label, x, y - 16);
  }

  if (v.rot !== 0 && opts.north !== false) drawNorth(ctx, w, opts.top ?? 24, v, th);

  if (f.me) {
    const [x, y] = v.P(f.me.x, f.me.y);
    ctx.fillStyle = th.accentSoft;
    ctx.beginPath();
    ctx.arc(x, y, f.me.psi !== undefined ? 15 : 16, 0, Math.PI * 2);
    ctx.fill();
    if (f.me.psi !== undefined) {
      // 지도를 돌렸으면 화살표도 같이 (진행 방향 위면 늘 위를 가리킨다)
      const [tx, ty] = screenDir(v, Math.cos(f.me.psi), Math.sin(f.me.psi));
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

/** 진행 방향 위 보기에서 북쪽이 어디인지 (왼쪽 위 작은 나침반. 오른쪽 위는 재생 화면의 보기 버튼 자리) */
function drawNorth(ctx: Ctx, _w: number, top: number, v: MapView, th: OverlayTheme): void {
  const cx = 28;
  const cy = top + 14;
  const [nx, ny] = screenDir(v, 0, 1);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(16, 17, 20, 0.85)';
  ctx.fill();
  ctx.strokeStyle = th.cardLine;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + nx * 11, cy + ny * 11);
  ctx.lineTo(cx - ny * 4, cy + nx * 4);
  ctx.lineTo(cx + ny * 4, cy - nx * 4);
  ctx.closePath();
  ctx.fillStyle = th.slow;
  ctx.fill();
  ctx.font = `700 9px ${th.sans}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = th.fg;
  ctx.fillText('N', cx - nx * 7, cy - ny * 7);
}
