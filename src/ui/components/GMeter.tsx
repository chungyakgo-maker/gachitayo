// G미터: 원 안에서 움직이는 점 (사양서 8.4). 바깥 원 1 g, 안쪽 원 0.5 g. 위가 제동, 왼쪽이 좌.
export interface GMeterProps {
  /** 앞(+)·뒤 g */
  gx: number | null;
  /** 왼쪽(+)·오른쪽 g */
  gy: number | null;
  size: number;
}

export function gLabel(gx: number | null, gy: number | null): { lat: string; long: string; latV: string; longV: string } {
  return {
    lat: gy !== null && gy < 0 ? '우' : '좌',
    latV: gy === null ? '—' : Math.abs(gy).toFixed(2),
    long: gx !== null && gx > 0 ? '가속' : '제동',
    longV: gx === null ? '—' : Math.abs(gx).toFixed(2),
  };
}

export function GMeter({ gx, gy, size }: GMeterProps) {
  const c = size / 2;
  const R = size * (size >= 100 ? 52 / 124 : 28 / 64);
  const big = size >= 100;
  const clamp = (v: number) => Math.max(-1.2, Math.min(1.2, v));
  const dx = gy === null ? 0 : -clamp(gy) * R;
  const dy = gx === null ? 0 : clamp(gx) * R;
  const l = gLabel(gx, gy);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`G미터: ${l.lat} ${l.latV}g, ${l.long} ${l.longV}g`}>
      <circle cx={c} cy={c} r={R} fill="none" stroke="#3A3F45" strokeWidth={1.5} />
      <circle cx={c} cy={c} r={R / 2} fill="none" stroke="#2A2E33" strokeWidth={1} />
      <path d={`M${c} ${c - R}v${2 * R}M${c - R} ${c}h${2 * R}`} stroke="#22262B" strokeWidth={1} />
      {big && (
        <>
          <text x={c} y={2} textAnchor="middle" dominantBaseline="hanging" fontSize={9} fill="#8A9199">
            제동
          </text>
          <text x={2} y={c + 4} fontSize={9} fill="#8A9199">
            좌
          </text>
          <path d={`M${c} ${c}L${c + dx} ${c + dy}`} stroke="#ECEEF0" strokeOpacity={0.35} strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      {gx !== null && gy !== null && <circle cx={c + dx} cy={c + dy} r={big ? 7 : 5} fill="#ECEEF0" />}
    </svg>
  );
}
