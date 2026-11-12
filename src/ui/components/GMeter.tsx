// G미터: 원 안에서 움직이는 점 (사양서 8.4). 바깥 원 = 최대값(설정, 기본 2 g), 안쪽 눈금 원, 위가 제동, 왼쪽이 좌.
// 글자 없이 칸을 꽉 채운다 (사용자 요청). 바깥 원 값만 작게, 보정 전 임시 G면 점이 속 빈 원.
// 최근 2초 궤적을 다듬은 곡선으로, 오래된 것부터 옅게.
// 대시보드 모드용 SVG (칸 크기에 맞춰 늘어난다). 지도 모드는 같은 모양을 캔버스로 그린다 (overlay/draw.ts drawGMeter)
import { gLabel } from '../overlay/frame';
import { G_MAX_DEFAULT, gRings, gToUnit, gTrailCurves, trailAlpha } from '../overlay/gmeter';

export { gLabel };
export interface GMeterProps {
  /** 앞(+)·뒤 g */
  gx: number | null;
  /** 왼쪽(+)·오른쪽 g */
  gy: number | null;
  /** 바깥 원 g (기본 2) */
  max?: number;
  /** 최근 G [앞뒤, 좌우] (오래된 것부터) */
  trail?: ReadonlyArray<readonly [number, number]>;
  /** 보정 전 임시 G */
  estimated?: boolean;
}

/** 좌표계 크기 (그려지는 크기는 감싼 칸에 맞춘다) */
const S = 200;

export function GMeter({ gx, gy, max = G_MAX_DEFAULT, trail, estimated = false }: GMeterProps) {
  const c = S / 2;
  const dotR = 11;
  const R = c - dotR - 2;
  const rings = gRings(max);
  const curves = gTrailCurves(trail, max);
  const P = (u: readonly [number, number]) => `${(c + u[0] * R).toFixed(1)} ${(c + u[1] * R).toFixed(1)}`;
  const dot = gx !== null && gy !== null ? gToUnit(gx, gy, max) : null;
  const l = gLabel(gx, gy);
  return (
    <svg
      className="g-meter"
      viewBox={`0 0 ${S} ${S}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`G미터${estimated ? '(추정)' : ''}: ${l.lat} ${l.latV}g, ${l.long} ${l.longV}g (최대 ${max}g)`}
    >
      {rings.map((g, i) => {
        const outer = i === rings.length - 1;
        return <circle key={g} cx={c} cy={c} r={(R * g) / max} fill="none" stroke={outer ? '#3A3F45' : g === 1 ? '#30353B' : '#24282D'} strokeWidth={outer ? 2 : 1.5} vectorEffect="non-scaling-stroke" />;
      })}
      <path d={`M${c} ${c - R}v${2 * R}M${c - R} ${c}h${2 * R}`} stroke="#22262B" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <text x={c + R * 0.6} y={c - R * 0.78} dominantBaseline="middle" fontSize={13} fill="#5E656D" fontFamily="IBM Plex Mono, monospace">
        {max}g
      </text>
      {curves.map((b, i) => (
        <path
          key={i}
          className="g-trail"
          d={`M${P(b.from)}C${P(b.c1)} ${P(b.c2)} ${P(b.to)}`}
          fill="none"
          stroke="#AACAE6"
          strokeOpacity={trailAlpha(i, curves.length)}
          strokeWidth={5}
          strokeLinecap="round"
        />
      ))}
      {dot &&
        (estimated ? (
          <circle className="g-dot estimated" cx={c + dot[0] * R} cy={c + dot[1] * R} r={dotR - 1.5} fill="none" stroke="#ECEEF0" strokeWidth={3} />
        ) : (
          <circle className="g-dot" cx={c + dot[0] * R} cy={c + dot[1] * R} r={dotR} fill="#ECEEF0" />
        ))}
    </svg>
  );
}
