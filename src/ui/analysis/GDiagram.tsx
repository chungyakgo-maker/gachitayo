// G 다이어그램 (사양서 8.6): 랩 A의 좌우 G(가로, 왼쪽 +는 왼쪽)와 앞뒤 G(세로, 위가 제동) 점들. 고른 지점은 크게.
// 방향별 최대 G 점·선 (2026-11-20 세영 "분석에 있는 G-force는 왜 그대로?" → 시안 docs/mock/2026-11-20-gpeaks-analysis.jpg):
// 주행 화면 G미터와 같은 셈·모양으로 그 랩의 바깥 테두리를 하늘색 점들 위, 고른 지점 아래에
import { useMemo } from 'react';
import { lapGPeaks, type GPeak } from '../../engine/derive/gPeaks';
import type { ProcessedTrack } from '../../engine/process/processDrive';
import { OverlayCanvas } from '../components/OverlayCanvas';
import { drawGPeaks } from '../overlay/draw';
import { G_MAX_DEFAULT, gRings } from '../overlay/gmeter';

const G = 9.80665;

export function GDiagram({ p, lapNo, selected, max = G_MAX_DEFAULT }: { p: ProcessedTrack; lapNo: number; selected: number | null; max?: number }) {
  // 랩이 바뀔 때만 다시 센다 (고른 지점을 옮길 때마다 다시 그리므로)
  const peaks = useMemo(() => lapGPeaks(p, lapNo), [p, lapNo]);
  return <OverlayCanvas className="g-diagram" label={`G 다이어그램: 랩 ${lapNo}`} draw={(ctx, w, h) => drawGDiagram(ctx, w, h, { p, lapNo, selected, max, peaks })} />;
}

/** G 다이어그램 그리기 (시험에서도 부른다). peaks 가 없으면 그 랩에서 센다 */
export function drawGDiagram(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  { p, lapNo, selected, max = G_MAX_DEFAULT, peaks }: { p: ProcessedTrack; lapNo: number; selected: number | null; max?: number; peaks?: ReadonlyArray<GPeak> },
): void {
  const c = Math.min(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  const R = c - 18; // 최대값 (설정의 G미터 최대값)
  if (R <= 4) return; // 아직 크기가 정해지지 않음
  const scale = R / max;
  ctx.strokeStyle = '#2a2e33';
  ctx.lineWidth = 1;
  for (const g of gRings(max)) {
    ctx.beginPath();
    ctx.arc(cx, cy, g * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx, cy + R);
  ctx.stroke();
  ctx.font = '400 10px IBM Plex Sans KR, sans-serif';
  ctx.fillStyle = '#8a9199';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('제동', cx, cy - R - 14);
  ctx.textBaseline = 'bottom';
  ctx.fillText('가속', cx, cy + R + 14);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('좌', cx - R - 14, cy);
  ctx.textAlign = 'right';
  ctx.fillText('우', cx + R + 14, cy);
  ctx.fillText('1g', cx + scale - 2, cy - 8);
  ctx.fillText(`${max}g`, cx + R - 2, cy - 8);
  ctx.fillStyle = 'rgba(170, 202, 230, 0.35)';
  for (let k = 0; k < p.n; k++) {
    if (p.lapNo[k] !== lapNo) continue;
    const ax = p.ax[k];
    const ay = p.ay[k];
    if (ax === null || ay === null || ax === undefined || ay === undefined) continue;
    // 왼쪽 G는 왼쪽에, 제동(−앞뒤)은 위에
    ctx.fillRect(cx - (ay / G) * scale - 1.5, cy + (ax / G) * scale - 1.5, 3, 3);
  }
  // 방향별 최대 G (하늘색 점들 위, 고른 지점 아래)
  drawGPeaks(ctx, cx, cy, R, peaks ?? lapGPeaks(p, lapNo), max);
  if (selected !== null) {
    const ax = p.ax[selected];
    const ay = p.ay[selected];
    if (ax !== null && ay !== null && ax !== undefined && ay !== undefined) {
      ctx.fillStyle = '#eceef0';
      ctx.beginPath();
      ctx.arc(cx - (ay / G) * scale, cy + (ax / G) * scale, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
