// 바이크 기울기 칸 (2026-11-18 세영 승인 시안 docs/mock/2026-11-18-lean.jpg, "바이크 그림은 빼, 깔끔한 바늘로"):
// 반원 눈금(왼쪽 60° ~ 오른쪽 60°), 가운데 아래 축에서 각도를 가리키는 바늘, 오른쪽 위 큰 숫자.
// 왼쪽 파랑 · 오른쪽 빨강(커브 표지판 색과 같은 뜻), 이번 주행 최대는 호 위 작은 삼각형과 아래 글자.
import { LEAN } from '../../engine/derive/lean';
import { drawPanel, type Ctx } from './draw';
import type { OverlayFrame } from './frame';
import type { OverlayTheme } from './theme';

export const LEAN_COLOR = { left: '#4da3ff', right: '#ff5b4f' } as const;
/** 이보다 작으면 똑바로 (흰색, "왼쪽/오른쪽" 없음) */
const STRAIGHT_DEG = 0.5;
/** 그리는 칸 크기: 주행 화면 상단 칸(약 174 × 100) 비율. 이 비율로 그리고 칸에 맞춰 줄이거나 늘린다
 * (시안은 190 × 140이었지만 그대로 줄이면 아래 작은 글씨가 7 px 남짓이 돼 같은 모양을 넓게 다시 놓았다) */
const BOX = { w: 176, h: 100 } as const;

type LeanFrame = Pick<OverlayFrame, 'hasState' | 'leanDeg' | 'maxLeanLeftDeg' | 'maxLeanRightDeg'>;

export const leanSide = (deg: number): 'left' | 'right' | null => (deg <= -STRAIGHT_DEG ? 'left' : deg >= STRAIGHT_DEG ? 'right' : null);

/** 화면 읽기용 글: "기울기 왼쪽 32도 (최대 왼쪽 41도, 오른쪽 38도)" */
export function leanLabel(f: LeanFrame): string {
  const d = f.hasState ? f.leanDeg : null;
  const side = d === null || d === undefined ? null : leanSide(d);
  const now = d === null || d === undefined ? '—' : side ? `${side === 'left' ? '왼쪽' : '오른쪽'} ${Math.round(Math.abs(d))}도` : '0도';
  return `기울기 ${now} (최대 왼쪽 ${Math.round(f.maxLeanLeftDeg ?? 0)}도, 오른쪽 ${Math.round(f.maxLeanRightDeg ?? 0)}도)`;
}

/** 기울기 칸 하나. panel이면 바탕도 그린다 (영상 입히기·대시보드) */
export function drawLeanTile(ctx: Ctx, w: number, h: number, f: LeanFrame, th: OverlayTheme, opts: { panel?: boolean } = {}): void {
  if (opts.panel) drawPanel(ctx, w, h, th, 'none', 16);
  const deg = f.hasState && f.leanDeg != null ? Math.max(-LEAN.maxDeg, Math.min(LEAN.maxDeg, f.leanDeg)) : null;
  const side = deg === null ? null : leanSide(deg);
  const col = side === 'left' ? LEAN_COLOR.left : side === 'right' ? LEAN_COLOR.right : th.fg;
  const k = Math.min(w / BOX.w, h / BOX.h);
  ctx.save();
  // 시안 칸 비율 그대로, 칸 가운데에
  ctx.translate((w - BOX.w * k) / 2, (h - BOX.h * k) / 2);
  ctx.scale(k, k);
  const cx = 88;
  const cy = 86;
  const r = 50;
  // 각도 a(도, + 오른쪽)의 호 위 점: 위가 0°
  const at = (a: number, rr = r): [number, number] => [cx + rr * Math.sin((a * Math.PI) / 180), cy - rr * Math.cos((a * Math.PI) / 180)];
  const arc = (a: number, b: number) => {
    ctx.beginPath();
    // 캔버스 각도는 x축에서 시계 방향: 위(0°) = −90°
    ctx.arc(cx, cy, r, ((Math.min(a, b) - 90) * Math.PI) / 180, ((Math.max(a, b) - 90) * Math.PI) / 180);
  };
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  // 이름
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 11px ${th.sans}`;
  ctx.fillStyle = th.fgDim;
  ctx.textAlign = 'left';
  ctx.fillText('기울기', 10, 17);
  // 바탕 호 + 지금 각도까지 색 호
  arc(-LEAN.maxDeg, LEAN.maxDeg);
  ctx.strokeStyle = '#2c3137';
  ctx.lineWidth = 7;
  ctx.stroke();
  if (deg !== null && side) {
    arc(0, deg);
    ctx.strokeStyle = col;
    ctx.stroke();
  }
  // 눈금 (15° 마다, 30°·0°는 조금 길게)
  ctx.strokeStyle = '#5a6068';
  ctx.lineWidth = 1.4;
  for (const a of [-45, -30, -15, 0, 15, 30, 45]) {
    const [x0, y0] = at(a, r - 8);
    const [x1, y1] = at(a, r - (a % 30 === 0 ? 14 : 11));
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  // 이번 주행 최대: 호 바깥 작은 삼각형 (안쪽을 가리킨다)
  for (const [a, c] of [
    [-(f.maxLeanLeftDeg ?? 0), LEAN_COLOR.left],
    [f.maxLeanRightDeg ?? 0, LEAN_COLOR.right],
  ] as const) {
    if (Math.abs(a) < 1) continue;
    const aa = Math.max(-LEAN.maxDeg, Math.min(LEAN.maxDeg, a));
    const [x, y] = at(aa, r + 7);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(((aa + 180) * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(4, 4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
    ctx.restore();
  }
  // 바늘 (모르면 바늘 없이 눈금만)
  if (deg !== null) {
    const [x1, y1] = at(deg, r - 12);
    const [x0, y0] = at(deg + 180, 8);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = th.tile;
    ctx.fill();
  }
  // 큰 숫자 + 왼쪽/오른쪽
  ctx.textAlign = 'right';
  ctx.font = `700 24px ${th.mono}`;
  ctx.fillStyle = col;
  ctx.fillText(deg === null ? '—' : `${Math.round(Math.abs(deg))}°`, BOX.w - 10, 26);
  if (side) {
    ctx.font = `600 10.5px ${th.sans}`;
    ctx.fillText(side === 'left' ? '왼쪽' : '오른쪽', BOX.w - 10, 40);
  }
  // 이번 주행 최대
  ctx.font = `400 10px ${th.sans}`;
  ctx.fillStyle = th.fgDim;
  ctx.fillText(`오른 ${Math.round(f.maxLeanRightDeg ?? 0)}°`, BOX.w - 10, BOX.h - 5);
  ctx.textAlign = 'left';
  ctx.fillText(`최대 왼 ${Math.round(f.maxLeanLeftDeg ?? 0)}°`, 10, BOX.h - 5);
  ctx.restore();
}
