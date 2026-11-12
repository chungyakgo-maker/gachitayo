// 지도 타일 없는 코스 지도 (M5 결정 1): 코스 선, 출발선(편도면 도착선), 내 위치, 베스트 고스트, 지나온 경로.
// 통신이 끊겨도 보이고 발열이 적다. 좌표는 코스 원점(코스가 없으면 첫 GPS) 기준 평면 m.
import { useMemo } from 'react';
import { toLocal } from '../../engine/geo';
import { gateSegment } from '../../engine/course/geometry';
import type { Course } from '../../types/course';
import { useElementSize } from '../hooks/useElementSize';

type XY = readonly [number, number];

export interface CourseMapProps {
  course: Course | null;
  me?: { x: number; y: number; psi?: number } | null;
  ghost?: { x: number; y: number } | null;
  path?: ReadonlyArray<XY>;
  /** main: 메인 지도, drive: 주행 지도, mini: 종료 요약의 작은 지도 */
  variant: 'main' | 'drive' | 'mini';
  /** 아래쪽을 가리는 띠 높이 (px) */
  insetBottom?: number;
  label?: string;
}

const STYLE = {
  main: { wide: '#24282D', wideW: 12, thin: '#4A5057', gate: '#ECEEF0', bg: '#0B0C0E', grid: '#14171A' },
  drive: { wide: '#1F2327', wideW: 14, thin: '#3A3F45', gate: '#C9CDD2', bg: '#08090A', grid: null },
  mini: { wide: '#24282D', wideW: 8, thin: '#4A5057', gate: '#ECEEF0', bg: '#0B0C0E', grid: null },
} as const;

export function CourseMap({ course, me, ghost, path, variant, insetBottom = 0, label }: CourseMapProps) {
  const { ref, width: W, height: H } = useElementSize<HTMLDivElement>();
  const st = STYLE[variant];
  const accent = '#aacae6';

  const line = useMemo<XY[]>(() => {
    if (!course?.centerline) return [];
    return course.centerline.map(([lat, lon]) => {
      const p = toLocal(course.origin, lat, lon);
      return [p.x, p.y] as const;
    });
  }, [course]);
  const gates = useMemo(() => {
    if (!course) return null;
    const start = gateSegment(course.startGate, course.origin);
    const finish = course.kind === 'point_to_point' ? gateSegment(course.finishGate, course.origin) : null;
    return { start, finish };
  }, [course]);

  // 화면에 맞추기: 코스가 있으면 코스, 없으면 지나온 경로와 내 위치
  const pathLen = path?.length ?? 0;
  const view = useMemo(() => {
    const pts: XY[] = line.length ? line : [...(path ?? []), ...(me ? [[me.x, me.y] as const] : [])];
    if (!line.length && gates) pts.push([gates.start.cx, gates.start.cy]);
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
    // 너무 작으면(출발 직후) 200 m 범위
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
    const m = variant === 'mini' ? 16 : 44;
    const top = variant === 'drive' ? 24 : m;
    const aw = W - 2 * m;
    const ah = H - top - m - insetBottom;
    const sc = Math.max(1e-6, Math.min(aw / (maxX - minX), ah / (maxY - minY)));
    const ox = m + (aw - (maxX - minX) * sc) / 2;
    const oy = top + (ah - (maxY - minY) * sc) / 2;
    return { sc, X: (x: number) => ox + (x - minX) * sc, Y: (y: number) => oy + (maxY - y) * sc };
    // 경로는 같은 배열이 늘어나므로 길이로 다시 계산한다. 코스가 있으면 코스로만 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, gates, W, H, insetBottom, variant, line.length ? 0 : pathLen, line.length ? 0 : Math.round((me?.x ?? 0) / 50), line.length ? 0 : Math.round((me?.y ?? 0) / 50)]);

  const courseD = useMemo(() => {
    if (!view || line.length < 2) return '';
    let d = '';
    line.forEach(([x, y], i) => {
      d += `${i ? 'L' : 'M'}${view.X(x).toFixed(1)} ${view.Y(y).toFixed(1)}`;
    });
    return course?.kind === 'loop' ? `${d}Z` : d;
  }, [view, line, course?.kind]);

  const pathD = useMemo(() => {
    if (!view || !path || path.length < 2) return '';
    let d = '';
    path.forEach(([x, y], i) => {
      d += `${i ? 'L' : 'M'}${view.X(x).toFixed(1)} ${view.Y(y).toFixed(1)}`;
    });
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, pathLen]);

  const grid = useMemo(() => {
    if (!st.grid) return '';
    let d = '';
    for (let gx = 24; gx < W; gx += 48) d += `M${gx} 0V${H}`;
    for (let gy = 24; gy < H; gy += 48) d += `M0 ${gy}H${W}`;
    return d;
  }, [st.grid, W, H]);

  const gateLine = (g: ReturnType<typeof gateSegment>, half = 10) => {
    if (!view) return null;
    const cx = view.X(g.cx);
    const cy = view.Y(g.cy);
    // 게이트 선은 진행 방향에 수직, 화면에서 ±10 px
    const nx = -g.dy;
    const ny = -g.dx;
    return { d: `M${cx + nx * half} ${cy + ny * half}L${cx - nx * half} ${cy - ny * half}`, cx, cy, bx: cx - g.dx * 20, by: cy + g.dy * 20 };
  };
  const start = gates ? gateLine(gates.start) : null;
  const finish = gates?.finish ? gateLine(gates.finish) : null;

  let meEl = null;
  if (view && me) {
    const x = view.X(me.x);
    const y = view.Y(me.y);
    if (me.psi !== undefined && variant !== 'main') {
      const tx = Math.cos(me.psi);
      const ty = -Math.sin(me.psi);
      const ox = -ty;
      const oy = tx;
      const tip = `${x + tx * 12} ${y + ty * 12}`;
      const l = `${x - tx * 7 + ox * 7} ${y - ty * 7 + oy * 7}`;
      const r = `${x - tx * 7 - ox * 7} ${y - ty * 7 - oy * 7}`;
      meEl = (
        <g>
          <circle cx={x} cy={y} r={15} fill={accent} fillOpacity={0.16} />
          <path d={`M${tip}L${l}L${r}Z`} fill="#ECEEF0" stroke={accent} strokeWidth={2} strokeLinejoin="round" />
        </g>
      );
    } else {
      meEl = (
        <g>
          <circle cx={x} cy={y} r={16} fill={accent} fillOpacity={0.16} />
          <circle cx={x} cy={y} r={6.5} fill="#ECEEF0" stroke={accent} strokeWidth={3} />
          {variant === 'main' && (
            <text x={x} y={y - 24} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#ECEEF0">
              나
            </text>
          )}
        </g>
      );
    }
  }

  let ghostEl = null;
  if (view && ghost) {
    const x = view.X(ghost.x);
    const y = view.Y(ghost.y);
    const w = 94;
    const cx = Math.min(Math.max(x, w / 2 + 6), W - w / 2 - 6);
    const cy = Math.max(18, y - 30);
    ghostEl = (
      <g>
        <circle cx={x} cy={y} r={7} fill="none" stroke="#ECEEF0" strokeWidth={1.5} strokeDasharray="3 2" strokeOpacity={0.8} />
        <rect x={cx - w / 2} y={cy - 12} width={w} height={24} rx={12} fill="#101114" stroke="#5E656D" strokeDasharray="3 2" />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill="#C9CDD2">
          베스트 고스트
        </text>
      </g>
    );
  }

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label ?? '코스 지도'} style={{ display: 'block' }}>
        {grid && <path d={grid} stroke={st.grid!} strokeWidth={1} fill="none" />}
        {courseD && <path d={courseD} fill="none" stroke={st.wide} strokeWidth={st.wideW} strokeLinejoin="round" strokeLinecap="round" />}
        {courseD && <path d={courseD} fill="none" stroke={st.thin} strokeWidth={1.5} strokeLinejoin="round" />}
        {pathD && <path d={pathD} fill="none" stroke={accent} strokeOpacity={0.55} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {start && <path d={start.d} stroke={st.gate} strokeWidth={3} strokeLinecap="round" />}
        {start && variant !== 'drive' && (
          <text x={start.bx} y={start.by} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#9AA1A9">
            출발
          </text>
        )}
        {finish && <path d={finish.d} stroke={st.gate} strokeWidth={3} strokeLinecap="round" strokeDasharray="4 3" />}
        {finish && variant !== 'drive' && (
          <text x={finish.bx} y={finish.by} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#9AA1A9">
            도착
          </text>
        )}
        {ghostEl}
        {meEl}
      </svg>
    </div>
  );
}
