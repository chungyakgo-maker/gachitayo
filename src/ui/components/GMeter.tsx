// G미터: 원 안에서 움직이는 점 (사양서 8.4). 바깥 원 = 최대값(설정, 기본 2 g), 안쪽 눈금 원, 위가 제동, 왼쪽이 좌.
// 최근 2초 궤적을 다듬은 곡선으로, 오래된 것부터 옅게 (사용자 요청).
// 대시보드 모드용 SVG. 지도 모드는 같은 모양을 캔버스로 그린다 (overlay/draw.ts drawGMeter)
import { gLabel } from '../overlay/frame';
import { G_MAX_DEFAULT, gRings, gToUnit, gTrailCurves, trailAlpha } from '../overlay/gmeter';

export { gLabel };
export interface GMeterProps {
  /** 앞(+)·뒤 g */
  gx: number | null;
  /** 왼쪽(+)·오른쪽 g */
  gy: number | null;
  size: number;
  /** 바깥 원 g (기본 2) */
  max?: number;
  /** 최근 G [앞뒤, 좌우] (오래된 것부터) */
  trail?: ReadonlyArray<readonly [number, number]>;
}

export function GMeter({ gx, gy, size, max = G_MAX_DEFAULT, trail }: GMeterProps) {
  const c = size / 2;
  const R = size * (size >= 100 ? 52 / 124 : 28 / 64);
  const big = size >= 100;
  const rings = gRings(max);
  const curves = gTrailCurves(trail, max);
  const P = (u: readonly [number, number]) => `${(c + u[0] * R).toFixed(1)} ${(c + u[1] * R).toFixed(1)}`;
  const dot = gx !== null && gy !== null ? gToUnit(gx, gy, max) : null;
  const l = gLabel(gx, gy);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`G미터: ${l.lat} ${l.latV}g, ${l.long} ${l.longV}g (최대 ${max}g)`}>
      {rings.map((g, i) => {
        const outer = i === rings.length - 1;
        return <circle key={g} cx={c} cy={c} r={(R * g) / max} fill="none" stroke={outer ? '#3A3F45' : g === 1 ? '#30353B' : '#24282D'} strokeWidth={outer ? 1.5 : 1} />;
      })}
      <path d={`M${c} ${c - R}v${2 * R}M${c - R} ${c}h${2 * R}`} stroke="#22262B" strokeWidth={1} />
      <text x={c + R * 0.74} y={c - R * 0.74 - (big ? 6 : 4)} dominantBaseline="middle" fontSize={big ? 9 : 8} fill="#5E656D" fontFamily="IBM Plex Mono, monospace">
        {max}g
      </text>
      {big && (
        <>
          <text x={c} y={2} textAnchor="middle" dominantBaseline="hanging" fontSize={9} fill="#8A9199">
            제동
          </text>
          <text x={2} y={c + 4} fontSize={9} fill="#8A9199">
            좌
          </text>
        </>
      )}
      {curves.map((b, i) => (
        <path
          key={i}
          className="g-trail"
          d={`M${P(b.from)}C${P(b.c1)} ${P(b.c2)} ${P(b.to)}`}
          fill="none"
          stroke="#AACAE6"
          strokeOpacity={trailAlpha(i, curves.length)}
          strokeWidth={big ? 3 : 2}
          strokeLinecap="round"
        />
      ))}
      {dot && <circle cx={c + dot[0] * R} cy={c + dot[1] * R} r={big ? 7 : 5} fill="#ECEEF0" />}
    </svg>
  );
}
