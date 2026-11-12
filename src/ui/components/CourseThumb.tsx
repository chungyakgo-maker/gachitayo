// 코스 썸네일 (사용자 요청): 작은 1:1 그림에 코스 모양. 코스 지도와 같은 색 (빨간 선 + 빛 번짐, 출발·도착 하늘색 점, 사용자 요청).
// 중심선이 없으면(지도로 만들고 첫 주행 전) 출발 점만.
import { useMemo } from 'react';
import type { Course } from '../../types/course';
import { COURSE_STYLE } from '../map/courseStyle';

const PAD = 9;
/** 그리는 점 수 상한 (긴 코스도 가볍게) */
const MAX_PTS = 120;

export function courseThumbPath(c: Course, size: number): { d: string; start: [number, number]; finish: [number, number] | null } | null {
  const line = c.centerline;
  const lat0 = c.startGate.lat;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xy = (lat: number, lon: number): [number, number] => [(lon - c.startGate.lon) * k, -(lat - lat0)];
  if (!line || line.length < 2) return null;
  const step = Math.max(1, Math.floor(line.length / MAX_PTS));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < line.length; i += step) pts.push(xy(line[i]![0], line[i]![1]));
  const last = line[line.length - 1]!;
  pts.push(xy(last[0], last[1]));
  if (c.kind === 'loop') pts.push(pts[0]!);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const s = (size - 2 * PAD) / span;
  const ox = (size - (maxX - minX) * s) / 2;
  const oy = (size - (maxY - minY) * s) / 2;
  const P = ([x, y]: [number, number]): [number, number] => [ox + (x - minX) * s, oy + (y - minY) * s];
  const sp = pts.map(P);
  const d = sp.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const f = xy(c.finishGate.lat, c.finishGate.lon);
  return { d, start: P(xy(c.startGate.lat, c.startGate.lon)), finish: c.kind === 'loop' ? null : P(f) };
}

export function CourseThumb({ course, size = 64 }: { course: Course; size?: number }) {
  const g = useMemo(() => courseThumbPath(course, size), [course, size]);
  return (
    <span className="course-thumb" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {g ? (
          <>
            <path d={g.d} fill="none" stroke="#ff3b30" strokeOpacity={0.22} strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" />
            <path d={g.d} fill="none" stroke="#ff453a" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={g.d} fill="none" stroke="#ffd2ce" strokeOpacity={0.8} strokeWidth={0.7} strokeLinejoin="round" strokeLinecap="round" />
            {g.finish && <circle cx={g.finish[0]} cy={g.finish[1]} r={3.4} fill={COURSE_STYLE.finish} stroke="#ffffff" strokeWidth={1.2} />}
            <circle cx={g.start[0]} cy={g.start[1]} r={3.4} fill={COURSE_STYLE.start} stroke="#ffffff" strokeWidth={1.2} />
          </>
        ) : (
          <circle cx={size / 2} cy={size / 2} r={4} fill={COURSE_STYLE.start} stroke="#ffffff" strokeWidth={1.2} />
        )}
      </svg>
    </span>
  );
}
