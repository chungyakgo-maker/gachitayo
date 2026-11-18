// 미니맵 (사양서 8.4 지도 모드, 13.1 오버레이의 미니맵): 지도 타일 없이 코스 선, 출발선(편도면 도착선),
// 내 위치 화살표, 베스트 고스트(점선 원), 지나온 경로.
// 보기 (사용자 요청): 전체 코스(한 화면에, 북쪽 위) / 나를 가운데(북쪽 위) / 진행 방향 위(내비처럼 지도가 돈다).
import { gateFromPoint, gateSegment } from '../../engine/course/geometry';
import type { RouteGuide } from '../../engine/route/routeGuide';
import { toLocal } from '../../engine/geo';
import type { Course } from '../../types/course';
import type { CarMarker } from '../../app/settings';
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

const routeCache = new WeakMap<RouteGuide, MapModel>();

/** 목적지 경로 → 그리기용 (코스 선과 같은 그림, 목적지에 도착선). 경로 안내의 평면(스냅숏 원점) 그대로 */
export function routeMapModel(guide: RouteGuide): MapModel {
  const hit = routeCache.get(guide);
  if (hit) return hit;
  // 카카오 점 그대로 (매 프레임 그리므로 2 m로 다시 찍은 선은 쓰지 않는다)
  const { x, y } = guide.raw;
  const n = x.length;
  const line: XY[] = [];
  for (let i = 0; i < n; i++) line.push([x[i]!, y[i]!] as const);
  const finish = n >= 2 ? gateSegment(gateFromPoint(x[n - 1]!, y[n - 1]!, Math.atan2(y[n - 1]! - y[n - 2]!, x[n - 1]! - x[n - 2]!), guide.origin), guide.origin) : null;
  const m: MapModel = { line, loop: false, start: null, finish };
  routeCache.set(guide, m);
  return m;
}

/** 평면 좌표(m) → 화면 좌표(px). rot: 지도를 돌린 각도(라디안, 반시계). 방향(화살표·게이트)을 같이 돌릴 때 쓴다 */
export interface MapView {
  P: (x: number, y: number) => [number, number];
  rot: number;
}

export type { MapViewMode } from '../../app/settings';

/** 나를 가운데 두는 보기: span = 화면 너비에 보일 거리(m), psi = 진행 방향(진행 방향 위일 때) */
/** 나를 가운데·진행 방향 위 보기에서 내 위치 자리: 가려지지 않은 영역의 위에서 75% (사용자 요청 "더 아래로, 앞쪽 경로가 더 잘 보이게") */
export const ME_ANCHOR = 0.75;

/** 선 지도 카메라 여백: 여백 안 가운데가 가려지지 않은 영역의 anchor 자리가 되게 (위 여백을 늘린다) */
export function anchorPadding(ins: { top: number; bottom: number }, h: number, anchor: number): { top: number; bottom: number } {
  const free = Math.max(0, h - ins.top - ins.bottom);
  return { top: ins.top + (2 * anchor - 1) * free, bottom: ins.bottom };
}

export function followView(me: { x: number; y: number }, w: number, h: number, opts: { spanM: number; insetBottom?: number; top?: number; headingUp?: number | null; anchor?: number }): MapView {
  const top = opts.top ?? 0;
  const cx = w / 2;
  const cy = top + (h - (opts.insetBottom ?? 0) - top) * (opts.anchor ?? 0.5);
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

/** 지도에 그릴 다른 사람. 그룹 주행이면 사람마다 색과 순서 번호 (사용자 요청 "컬러도 모두 다르게", "모두 지도에 표시") */
export interface MapPerson {
  x: number;
  y: number;
  label: string;
  color?: string;
  no?: number;
}

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
  friend?: MapPerson | null;
  /** 위치를 공유 중인 다른 친구들 (주행 중, 사용자 요청) */
  friends?: ReadonlyArray<MapPerson>;
  /** 돌린 지도에서 왼쪽 위 작은 나침반 (주행 화면은 나침반 버튼이 대신하므로 끈다) */
  north?: boolean;
  /** 내 차 표시 모양 (설정, 기본 화살표) */
  marker?: CarMarker;
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

const STYLE = { gate: '#C9CDD2' };

/**
 * 등록된 코스 선 (사용자 요청 "코스로 지날 때 경로가 너무 옅어서 안 보인다"): 지도 도로(하늘색 #aacae6)보다 밝고 두껍게,
 * 테두리는 하얀색(사용자 요청 "검정색 말고 하얀색"). 지나온 길(빨강)은 이 위에 그린다.
 */
export const COURSE_LINE = { outline: '#ffffff', outlineW: 10, line: '#9fd0ff', lineW: 6 } as const;
/** 코스 주행에서 이번 랩에 이미 지나온 코스 선: 옅게 (사용자 요청 "지나온 길이 빨간색이라 더 눈에 띄어 집중이 안 된다") */
export const COURSE_DONE = { line: 'rgba(159, 208, 255, 0.28)', lineW: 6 } as const;

/** 목적지 경로에서 지나온 거리 (지도에서 지울 만큼). 잠깐 경로를 벗어나 s가 없을 때는 마지막 값을 그대로 쓰고
 *  (지운 선이 다시 나타나지 않게), 다시 찾기로 경로가 바뀌면 새 경로의 처음부터 센다 */
export function routeDoneS<G extends object>(prev: { guide: G; s: number } | null, guide: G, s: number | null): { guide: G; s: number } | null {
  if (s !== null) return { guide, s };
  return prev && prev.guide === guide ? prev : null;
}

/** 코스 선을 s(m)에서 둘로 나눈다 (점 사이 거리로) */
function splitAt(pts: ReadonlyArray<XY>, s: number): [XY[], XY[]] {
  const done: XY[] = [pts[0]!];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const d = Math.hypot(bx - ax, by - ay);
    if (acc + d >= s) {
      const f = d > 0 ? (s - acc) / d : 0;
      const m: XY = [ax + (bx - ax) * f, ay + (by - ay) * f];
      done.push(m);
      return [done, [m, ...pts.slice(i)]];
    }
    acc += d;
    done.push(pts[i]!);
  }
  return [done, [pts[pts.length - 1]!]];
}

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
  const hasLine = model.line.length >= 2;
  if (hasLine) {
    // 코스 주행: 이번 랩에 지나온 코스 선은 옅게, 남은 코스 선은 밝게 (빨간 지나온 길 대신, 사용자 요청).
    // 목적지 주행: 지나온 경로는 아예 지운다 (내비처럼, 사용자 요청 "경로대로 가면 지나온 경로는 지워져야")
    const routeS = f.routeS ?? null;
    const s = routeS ?? f.courseS ?? null;
    const [split, rest] = s !== null && s > 0 ? splitAt(model.line, s) : [[], model.line];
    const done = routeS !== null ? [] : split;
    if (done.length >= 2) {
      polyline(ctx, done, v, false);
      ctx.strokeStyle = COURSE_DONE.line;
      ctx.lineWidth = COURSE_DONE.lineW;
      ctx.stroke();
    }
    if (rest.length >= 2) {
      polyline(ctx, rest, v, model.loop && done.length < 2);
      ctx.strokeStyle = COURSE_LINE.outline;
      ctx.lineWidth = COURSE_LINE.outlineW;
      ctx.stroke();
      ctx.strokeStyle = COURSE_LINE.line;
      ctx.lineWidth = COURSE_LINE.lineW;
      ctx.stroke();
    }
  }
  // 지나온 길(빨강)은 처음 기록할 때(코스 선이 없을 때)만 (사용자 요청)
  if (!hasLine && f.path && f.path.length >= 2) {
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
    const col = fp.color ?? th.friend;
    const no = fp.no;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, no ? 11 : 7, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = '#0d0e10';
    ctx.lineWidth = no ? 2.5 : 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (no) {
      ctx.font = `800 12px ${th.sans}`;
      ctx.fillStyle = '#0d0e10';
      ctx.fillText(String(no), x, y + 0.5);
      // 그룹 이름표는 지도 위에서도 읽히게 테두리
      ctx.font = `700 13px ${th.sans}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0b0c0e';
      ctx.strokeText(fp.label, x, y - 21);
      ctx.fillStyle = col;
      ctx.fillText(fp.label, x, y - 21);
    } else {
      ctx.font = `700 12px ${th.sans}`;
      ctx.fillStyle = col;
      ctx.fillText(fp.label, x, y - 16);
    }
  }

  if (v.rot !== 0 && opts.north !== false) drawNorth(ctx, w, opts.top ?? 24, v, th);

  if (f.me) {
    const [x, y] = v.P(f.me.x, f.me.y);
    // 지도를 돌렸으면 모양도 같이 (진행 방향 위면 늘 위를 가리킨다)
    const dir = f.me.psi !== undefined ? screenDir(v, Math.cos(f.me.psi), Math.sin(f.me.psi)) : null;
    drawMe(ctx, x, y, dir, opts.marker ?? 'arrow');
  }
  return v;
}

/** 내 차 표시 색 (사용자 요청 시안 2026-11-17: 화살표·흰 차·파란 점·빨간 차, 예전 작은 화살표의 약 2배) */
export const ME_MARKER = {
  arrow: { body: '#ffffff', edge: '#0d0e10', halo: 'rgba(170, 202, 230, 0.22)' },
  white: { body: '#ffffff', edge: '#0d0e10', halo: 'rgba(170, 202, 230, 0.22)', glass: '#1b2a3a', roof: '#e6edf5', head: '#9fd0ff', tail: '#ff5b4f' },
  blue: { body: '#3a86ff', edge: '#ffffff', halo: 'rgba(58, 134, 255, 0.18)', beam: 'rgba(58, 134, 255, 0.55)', beamEnd: 'rgba(58, 134, 255, 0)' },
  red: { body: '#e8382f', edge: '#0d0e10', halo: 'rgba(232, 56, 47, 0.22)', glass: '#1a1c20', roof: '#c92a22', head: '#fff3c4', tail: '#ffb3ab' },
} as const;

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** 그림자 (바탕 지도 위에서도 떠 보이게) 를 켜고 그린 뒤 끈다 */
function withShadow(ctx: Ctx, draw: () => void): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  draw();
  ctx.restore();
}

/** 내 위치. dir: 화면에서 진행 방향(단위 벡터), 모르면 null → 방향 없는 큰 점 */
function drawMe(ctx: Ctx, x: number, y: number, dir: readonly [number, number] | null, kind: CarMarker): void {
  const m = ME_MARKER[kind];
  ctx.setLineDash([]);
  ctx.lineJoin = 'round';
  if (!dir) {
    disc(ctx, x, y, 24, m.halo);
    withShadow(ctx, () => disc(ctx, x, y, 12, m.body));
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = m.edge;
    ctx.lineWidth = 3;
    ctx.stroke();
    return;
  }
  // 모양은 앞쪽이 위(0,-1)인 좌표로 그리고 진행 방향으로 돌린다
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(dir[0], -dir[1]));
  if (kind === 'arrow') drawArrowMark(ctx);
  else if (kind === 'blue') drawBlueMark(ctx);
  else drawCarMark(ctx, kind === 'red' ? ME_MARKER.red : ME_MARKER.white);
  ctx.restore();
}

/** 설정 화면의 작은 미리보기: 칸 가운데에 위를 보게, 줄여서 */
export function drawMeIcon(ctx: Ctx, w: number, h: number, kind: CarMarker): void {
  ctx.save();
  ctx.translate(w / 2, h / 2 + 2);
  ctx.scale(0.62, 0.62);
  drawMe(ctx, 0, 0, [0, -1], kind);
  ctx.restore();
}

/** A 화살표: 흰 내비 화살표 + 검은 테두리 (높이 44 px) */
function drawArrowMark(ctx: Ctx): void {
  const m = ME_MARKER.arrow;
  disc(ctx, 0, 0, 30, m.halo);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(18, 18);
    ctx.lineTo(0, 8);
    ctx.lineTo(-18, 18);
    ctx.closePath();
  };
  withShadow(ctx, () => {
    path();
    ctx.fillStyle = m.body;
    ctx.fill();
  });
  path();
  ctx.strokeStyle = m.edge;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  path();
  ctx.fillStyle = m.body;
  ctx.fill();
}

/** B·D 자동차: 위에서 본 차 (30 × 56 px), 앞유리로 방향이 보인다 */
function drawCarMark(ctx: Ctx, m: (typeof ME_MARKER)['white'] | (typeof ME_MARKER)['red']): void {
  disc(ctx, 0, 0, 34, m.halo);
  const bw = 30;
  const bh = 56;
  const l = -bw / 2;
  const t = -bh / 2;
  withShadow(ctx, () => {
    roundRect(ctx, l, t, bw, bh, 11);
    ctx.fillStyle = m.body;
    ctx.fill();
  });
  roundRect(ctx, l, t, bw, bh, 11);
  ctx.strokeStyle = m.edge;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // 앞유리·뒷유리
  ctx.fillStyle = m.glass;
  ctx.beginPath();
  ctx.moveTo(l + 5, t + 18);
  ctx.quadraticCurveTo(0, t + 11, l + bw - 5, t + 18);
  ctx.lineTo(l + bw - 7, t + 27);
  ctx.lineTo(l + 7, t + 27);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(l + 7, t + bh - 13);
  ctx.lineTo(l + bw - 7, t + bh - 13);
  ctx.lineTo(l + bw - 5, t + bh - 7);
  ctx.quadraticCurveTo(0, t + bh - 4, l + 5, t + bh - 7);
  ctx.closePath();
  ctx.fill();
  // 지붕
  roundRect(ctx, l + 7, t + 29, bw - 14, bh - 44, 3);
  ctx.fillStyle = m.roof;
  ctx.fill();
  // 전조등·미등
  for (const [cy, h, col] of [[t + 2.5, 3.5, m.head], [t + bh - 5.5, 3, m.tail]] as const) {
    ctx.fillStyle = col;
    roundRect(ctx, l + 4, cy, 6, h, 1.5);
    ctx.fill();
    roundRect(ctx, l + bw - 10, cy, 6, h, 1.5);
    ctx.fill();
  }
}

/** C 파란 점: 앱 파란색(로고 색) 점 + 앞쪽으로 퍼지는 빛 */
function drawBlueMark(ctx: Ctx): void {
  const m = ME_MARKER.blue;
  const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 72);
  g.addColorStop(0, m.beam);
  g.addColorStop(1, m.beamEnd);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 72, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
  ctx.closePath();
  ctx.fill();
  disc(ctx, 0, 0, 26, m.halo);
  withShadow(ctx, () => disc(ctx, 0, 0, 16, m.edge));
  disc(ctx, 0, 0, 12, m.body);
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5.5, 5);
  ctx.lineTo(0, 2.5);
  ctx.lineTo(-5.5, 5);
  ctx.closePath();
  ctx.fillStyle = m.edge;
  ctx.fill();
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
