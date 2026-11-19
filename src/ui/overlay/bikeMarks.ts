// 주행 지도의 내 바이크 표시 (2026-11-18 세영 승인 시안 docs/mock/2026-11-18-bike-mode.jpg):
// 위에서 내려다본 바이크 + 탄 사람 헬멧. 종류마다 색이 달라 작게 봐도 구별된다. "할리"는 상표라 이름은 크루저.
// 시안 SVG(64 × 64, 앞이 위)를 그대로 옮긴 그림 목록을 캔버스에 그린다.
import type { Ctx } from './draw';

export type BikeMarker = 'scooter' | 'sport' | 'cruiser' | 'naked' | 'motard';

const TIRE = '#1b1d21';
const DARK = '#14161a';
/** 핸들: 어두운 바탕 원 위에서도 보이게 시안보다 조금 밝게 (모타드처럼 핸들 폭으로 구별되는 종류가 있다) */
const BAR = '#5a6068';
const GLASS = '#20252c';
const SEAT = '#4a3426';
const CHROME = '#c9cdd2';
const WHITE = '#f2f4f6';

/** 종류별 몸통 색 (설정 미리보기·시험에서 알아본다) */
export const BIKE_MARK: Record<BikeMarker, { body: string; halo: string }> = {
  scooter: { body: '#7dd3c0', halo: 'rgba(125, 211, 192, 0.22)' },
  sport: { body: '#ff4d4d', halo: 'rgba(255, 77, 77, 0.22)' },
  cruiser: { body: '#ff9f43', halo: 'rgba(255, 159, 67, 0.22)' },
  naked: { body: '#4da3ff', halo: 'rgba(77, 163, 255, 0.22)' },
  motard: { body: '#ffd23f', halo: 'rgba(255, 210, 63, 0.22)' },
};

type Shape =
  | { r: [number, number, number, number, number]; fill: string }
  | { e: [number, number, number, number]; fill: string }
  | { c: [number, number, number]; fill: string }
  | { p: Array<[number, number]>; fill: string }
  /** 이차 곡선 선: [시작 x, y, 조절 x, y,끝 x, y] 여러 개 */
  | { q: Array<[number, number, number, number, number, number]>; stroke: string; width: number };

const rect = (x: number, y: number, w: number, h: number, rx: number, fill: string): Shape => ({ r: [x, y, w, h, rx], fill });
const helmet = (cy: number): Shape[] => [
  { e: [32, cy + 3, 8, 3.4], fill: '#3a3f45' },
  { c: [32, cy, 4.6], fill: WHITE },
  { q: [[28.6, cy - 2.2, 32, cy - 5.4, 35.4, cy - 2.2]], stroke: DARK, width: 2 },
];

function shapes(kind: BikeMarker): Shape[] {
  const b = BIKE_MARK[kind].body;
  switch (kind) {
    case 'scooter':
      return [
        rect(28.5, 6, 7, 11, 3.2, TIRE),
        rect(28, 45, 8, 12, 3.5, TIRE),
        { e: [32, 19, 10, 5.5], fill: b },
        rect(23.5, 18, 17, 30, 8, b),
        rect(20, 15.5, 24, 3.2, 1.6, BAR),
        rect(27, 33, 10, 15, 4.5, SEAT),
        ...helmet(34),
      ];
    case 'sport':
      return [
        rect(29, 2, 6, 12, 3, TIRE),
        rect(28.5, 48, 7, 14, 3.2, TIRE),
        { p: [[32, 5], [39, 19], [38, 31], [26, 31], [25, 19]], fill: b },
        { p: [[32, 9], [35.5, 17], [28.5, 17]], fill: GLASS },
        rect(25, 20, 14, 2.2, 1, BAR),
        rect(27, 29, 10, 13, 4, b),
        { p: [[28, 41], [36, 41], [33.5, 57], [30.5, 57]], fill: b },
        rect(29, 36, 6, 9, 2.5, GLASS),
        ...helmet(29),
      ];
    case 'cruiser':
      return [
        rect(28, 2, 8, 13, 3.8, TIRE),
        rect(27, 47, 10, 15, 4.5, TIRE),
        { e: [32, 10, 6.2, 7], fill: b },
        { q: [[18, 18, 22, 26, 29, 22], [35, 22, 42, 26, 46, 18]], stroke: CHROME, width: 2.6 },
        rect(29, 20.5, 6, 3, 1.2, CHROME),
        { e: [32, 29, 6.3, 8.5], fill: b },
        { c: [23.5, 33, 3], fill: CHROME },
        { c: [40.5, 33, 3], fill: CHROME },
        rect(25.5, 36, 13, 11, 5.5, SEAT),
        { e: [32, 52, 7.2, 8], fill: b },
        ...helmet(41),
      ];
    case 'naked':
      return [
        rect(28.75, 3, 6.5, 12, 3, TIRE),
        rect(28.25, 46, 7.5, 14, 3.4, TIRE),
        { c: [32, 15.5, 3.6], fill: '#fff4c2' },
        rect(18, 19, 28, 3, 1.5, BAR),
        rect(24.5, 22, 15, 15, 6.5, b),
        rect(28, 36, 8, 11, 3, GLASS),
        { p: [[29.5, 46], [34.5, 46], [33.5, 55], [30.5, 55]], fill: b },
        ...helmet(37),
      ];
    case 'motard':
      return [
        rect(29.5, 2, 5, 13, 2.5, TIRE),
        rect(29, 48, 6, 14, 2.8, TIRE),
        rect(27.5, 13.5, 9, 5.5, 1.2, WHITE),
        rect(14, 19, 36, 2.6, 1.3, BAR),
        rect(28.5, 21, 7, 12, 3, b),
        rect(29.2, 26, 5.6, 25, 2.8, GLASS),
        rect(25.5, 44, 3, 7, 1, b),
        rect(35.5, 44, 3, 7, 1, b),
        ...helmet(33),
      ];
  }
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k);
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k);
  ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}

function drawShape(ctx: Ctx, s: Shape): void {
  if ('q' in s) {
    ctx.beginPath();
    for (const [x0, y0, cx, cy, x1, y1] of s.q) {
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
    }
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }
  if ('r' in s) roundedRect(ctx, ...s.r);
  else if ('e' in s) {
    ctx.beginPath();
    ctx.ellipse(s.e[0], s.e[1], s.e[2], s.e[3], 0, 0, Math.PI * 2);
  } else if ('c' in s) {
    ctx.beginPath();
    ctx.arc(s.c[0], s.c[1], s.c[2], 0, Math.PI * 2);
  } else {
    ctx.beginPath();
    s.p.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  }
  ctx.fillStyle = s.fill;
  ctx.fill();
}

/** 바탕 원 반지름 (차 표시와 같은 크기 — 높이 약 56 px) */
const DISC = 31;
/** 시안 64 칸 → 화면 px */
const SCALE = 0.92;

/** 원점에 앞이 위인 바이크를 그린다 (지도 위에서도 보이게 어두운 원 + 그림자 + 옅은 색 테) */
export function drawBikeMark(ctx: Ctx, kind: BikeMarker): void {
  const m = BIKE_MARK[kind];
  ctx.beginPath();
  ctx.arc(0, 0, DISC + 6, 0, Math.PI * 2);
  ctx.fillStyle = m.halo;
  ctx.fill();
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(0, 0, DISC, 0, Math.PI * 2);
  ctx.fillStyle = '#0d0f14';
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.scale(SCALE, SCALE);
  ctx.translate(-32, -32);
  for (const s of shapes(kind)) drawShape(ctx, s);
  ctx.restore();
}
