// G 다이어그램 (사양서 8.6): 랩 A의 좌우 G(가로, 왼쪽 +는 왼쪽)와 앞뒤 G(세로, 위가 제동) 점들. 고른 지점은 크게.
import type { ProcessedTrack } from '../../engine/process/processDrive';
import { OverlayCanvas } from '../components/OverlayCanvas';
import { G_MAX_DEFAULT, gRings } from '../overlay/gmeter';

const G = 9.80665;

export function GDiagram({ p, lapNo, selected, max = G_MAX_DEFAULT }: { p: ProcessedTrack; lapNo: number; selected: number | null; max?: number }) {
  return (
    <OverlayCanvas
      className="g-diagram"
      label={`G 다이어그램: 랩 ${lapNo}`}
      draw={(ctx, w, h) => {
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
      }}
    />
  );
}
