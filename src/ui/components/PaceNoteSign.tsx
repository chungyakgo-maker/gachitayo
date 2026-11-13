// 커브 표지판 한 장 (사양서 8.4, 사용자 요청 시안): 둥근 네모, 왼쪽 연한 파랑·오른쪽 연한 빨강, 위쪽 정가운데에 숫자 등급
// (헤어핀·스퀘어는 그 이름), 그 아래 커브 모양 화살표. 화살표는 커브 모양 구간(직선·원호)을 따라 그리고 표지판 아래 칸에 맞춘다.
import type { PaceGrade, PaceMod } from '../../engine/course/paceNotes';

const THEME = {
  left: { bg: '#aacae6', fg: '#0d1a26' },
  right: { bg: '#f4a7a3', fg: '#3b0f0d' },
} as const;

/** 등급별 꺾이는 각도(°)와 둥근 정도 */
const G: Record<1 | 2 | 3 | 4 | 5 | 6, { deg: number; r: number }> = {
  6: { deg: 22, r: 40 },
  5: { deg: 38, r: 34 },
  4: { deg: 55, r: 28 },
  3: { deg: 75, r: 22 },
  2: { deg: 100, r: 17 },
  1: { deg: 125, r: 13 },
};

type Seg = ['line', number] | ['arc', number, number];

/** 커브 모양 → 구간 (원호는 같은 쪽으로) */
function segments(grade: PaceGrade, mod: PaceMod): Seg[] {
  if (grade === 'H') return [['line', 30], ['arc', 180, 13], ['line', 10]];
  if (grade === 'S') return [['line', 32], ['arc', 90, 2], ['line', 16]];
  const g = G[grade];
  if (mod === '조여짐') return [['line', 22], ['arc', g.deg * 0.3, g.r * 1.8], ['arc', g.deg * 0.35, g.r], ['arc', g.deg * 0.6, g.r * 0.5], ['line', 6]];
  if (mod === '풀림') return [['line', 22], ['arc', g.deg * 0.6, g.r * 0.5], ['arc', g.deg * 0.35, g.r], ['arc', g.deg * 0.3, g.r * 1.8], ['line', 8]];
  if (mod === '길게') return [['line', 18], ['arc', Math.min(g.deg * 1.9, 160), g.r * 1.15], ['line', 8]];
  return [['line', 28], ['arc', g.deg, g.r], ['line', 12]];
}

/** 화살표 선과 화살촉 (100×100 표지판 좌표, 숫자 줄 아래 칸에 맞춤) */
export function arrowShape(dir: 'left' | 'right', grade: PaceGrade, mod: PaceMod): { d: string; head: string; width: number } {
  const side = dir === 'left' ? 1 : -1;
  let x = 0;
  let y = 0;
  let dx = 0;
  let dy = -1;
  const pts: Array<[number, number]> = [[x, y]];
  for (const seg of segments(grade, mod)) {
    if (seg[0] === 'line') {
      x += dx * seg[1];
      y += dy * seg[1];
      pts.push([x, y]);
      continue;
    }
    const [, deg, r] = seg;
    const steps = Math.max(4, Math.round(deg / 4));
    const th = (deg * Math.PI) / 180 / steps;
    const c = Math.cos(side * th);
    const sn = Math.sin(side * th);
    for (let i = 0; i < steps; i++) {
      const ndx = dx * c + dy * sn;
      const ndy = -dx * sn + dy * c;
      dx = ndx;
      dy = ndy;
      x += dx * r * th;
      y += dy * r * th;
      pts.push([x, y]);
    }
  }
  const px = -dy;
  const py = dx;
  const head: Array<[number, number]> = [
    [x + dx * 9, y + dy * 9],
    [x - dx * 6 + px * 11, y - dy * 6 + py * 11],
    [x - dx * 6 - px * 11, y - dy * 6 - py * 11],
  ];
  const all = [...pts, ...head];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // 위쪽 숫자 줄 아래 칸 (사용자 요청: 숫자는 정가운데 최상단, 안 겹치게)
  const box = { x0: 14, x1: 86, y0: 38, y1: 90 };
  const sc = Math.min(1.25, (box.x1 - box.x0) / Math.max(1, maxX - minX), (box.y1 - box.y0) / Math.max(1, maxY - minY));
  const ox = (box.x0 + box.x1) / 2 - ((minX + maxX) / 2) * sc;
  const oy = (box.y0 + box.y1) / 2 - ((minY + maxY) / 2) * sc;
  const f = (p: [number, number]) => `${(ox + p[0] * sc).toFixed(1)} ${(oy + p[1] * sc).toFixed(1)}`;
  return { d: `M${pts.map(f).join(' L')}`, head: head.map((p) => f(p).replace(' ', ',')).join(' '), width: Math.max(6, 9 * Math.min(1, sc)) };
}

export const gradeLabel = (g: PaceGrade): string => (g === 'H' ? '헤어핀' : g === 'S' ? '스퀘어' : String(g));

export interface PaceNoteSignProps {
  dir: 'left' | 'right';
  grade: PaceGrade;
  mod?: PaceMod;
  size?: number;
}

export function PaceNoteSign({ dir, grade, mod = null, size = 96 }: PaceNoteSignProps) {
  const t = THEME[dir];
  const a = arrowShape(dir, grade, mod);
  const top = gradeLabel(grade);
  const named = grade === 'H' || grade === 'S';
  return (
    <svg className="pace-sign" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${dir === 'left' ? '왼쪽' : '오른쪽'} ${top}${mod ? ` ${mod}` : ''}`}>
      <rect x="1" y="1" width="98" height="98" rx="14" fill={t.bg} stroke="rgba(0,0,0,.35)" strokeWidth="2" />
      <path d={a.d} fill="none" stroke={t.fg} strokeWidth={a.width.toFixed(1)} strokeLinecap="round" strokeLinejoin="round" />
      <polygon points={a.head} fill={t.fg} />
      <text x="50" y={named ? 27 : 31} textAnchor="middle" fontWeight="800" fontSize={named ? 17 : 28} fill={t.fg}>
        {top}
      </text>
    </svg>
  );
}

/** 앞에 보일 커브가 없을 때: 회색 직진 표지판 (글자 없음) */
export function PaceIdleSign({ size = 96 }: { size?: number }) {
  return (
    <svg className="pace-sign idle" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="앞에 커브 없음">
      <rect x="1" y="1" width="98" height="98" rx="14" fill="#2a2e33" stroke="rgba(255,255,255,.08)" strokeWidth="2" />
      <path d="M50 84 L50 34" fill="none" stroke="#6b737c" strokeWidth="9" strokeLinecap="round" />
      <polygon points="50,20 39,36 61,36" fill="#6b737c" />
    </svg>
  );
}
