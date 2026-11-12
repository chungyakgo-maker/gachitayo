// "시각 t의 주행 상태" (사양서 13.1 확장 지점). 주행 화면은 실시간 스냅샷에서 만들고,
// 13.1 영상에 입히기는 같은 모양을 처리된 궤적에서 만들어 같은 그리기 함수(draw.ts, minimap.ts)에 넘긴다.
import type { WidgetId } from '../../app/settings';
import { WIDGET_LABEL } from '../../app/settings';
import type { LiveSnapshot } from '../../engine/live/livePipeline';
import { formatDelta, formatLapTime } from '../format';

export type XY = readonly [number, number];

export interface OverlayFrame {
  /** 세션 시계 ms */
  t: number;
  /** 위치를 아직 못 받았으면 false (값 대신 —) */
  hasState: boolean;
  hasCourse: boolean;
  hasRef: boolean;
  /** 0이면 출발선 전 */
  lapNo: number;
  lapElapsedMs: number | null;
  /** 비교 랩 대비 초 (빠르면 −) */
  delta: number | null;
  speedKmh: number | null;
  maxSpeedKmh: number | null;
  /** 앞(+)·뒤 g */
  gx: number | null;
  /** 왼쪽(+)·오른쪽 g */
  gy: number | null;
  currentSector: number | null;
  sectorDeltas: ReadonlyArray<number | null>;
  /** 코스 원점 기준 평면 m. psi는 x축에서 반시계 라디안 */
  me: { x: number; y: number; psi?: number } | null;
  ghost: { x: number; y: number } | null;
  /** 지나온 경로 (첫 주행) */
  path?: ReadonlyArray<XY>;
}

export function frameFromLive(snap: LiveSnapshot | null, hasCourse: boolean, hasRef: boolean): OverlayFrame {
  const st = snap?.state ?? null;
  return {
    t: snap?.t ?? 0,
    hasState: st !== null,
    hasCourse,
    hasRef,
    lapNo: st?.lapNo ?? 0,
    lapElapsedMs: st?.lapElapsedMs ?? null,
    delta: st?.delta ?? null,
    // 스냅샷은 있는데 아직 속도가 없으면 0 (정차)
    speedKmh: st?.speedKmh ?? (snap ? 0 : null),
    maxSpeedKmh: st?.maxSpeedKmh ?? null,
    gx: st?.gx ?? null,
    gy: st?.gy ?? null,
    currentSector: st?.currentSector ?? null,
    sectorDeltas: st?.sectorDeltas ?? [null, null, null],
    me: snap?.pos ?? null,
    ghost: hasCourse && hasRef && snap?.ghost ? { x: snap.ghost.x, y: snap.ghost.y } : null,
    path: hasCourse ? undefined : snap?.path,
  };
}

export type Tone = 'fast' | 'slow' | 'none';
export const toneOf = (d: number | null): Tone => (d === null ? 'none' : d < 0 ? 'fast' : d > 0 ? 'slow' : 'none');
const wordOf = (d: number | null) => (d === null ? '' : d < 0 ? '빠름' : d > 0 ? '느림' : '같음');

export interface Headline {
  label: string;
  text: string;
  word: string;
  tone: Tone;
  /** 첫 주행: 델타 대신 경과 시간을 흰 글자로 */
  plain: boolean;
}

/** 델타 패널에 보여줄 것: 첫 주행이면 출발 뒤 경과, 아니면 델타 */
export function headline(f: OverlayFrame): Headline {
  if (!f.hasCourse) return { label: '코스 기록 중 · 출발 뒤', text: formatLapTime(f.lapElapsedMs, 1), word: '', tone: 'none', plain: true };
  if (!f.hasRef) return { label: '비교 랩 없음', text: '—', word: '', tone: 'none', plain: false };
  if (!f.hasState || f.lapNo === 0) return { label: '출발선을 지나면 시작', text: '—', word: '', tone: 'none', plain: false };
  return { label: '베스트 대비', text: formatDelta(f.delta), word: wordOf(f.delta), tone: toneOf(f.delta), plain: false };
}

const kmh = (v: number | null) => (v === null ? '—' : String(Math.round(v)));

export interface ValueTile {
  label: string;
  value: string;
  unit: string;
  tone: Tone;
  /** 구간 기록처럼 긴 값은 조금 작게 */
  small: boolean;
}

/** 상단 표시 값 한 칸 (G미터 제외, 사양서 8.3.1) */
export function widgetValue(id: Exclude<WidgetId, 'g'>, f: OverlayFrame): ValueTile {
  const label = WIDGET_LABEL[id];
  if (id === 'speed') return { label, value: kmh(f.speedKmh), unit: 'km/h', tone: 'none', small: false };
  if (id === 'vmax') return { label, value: kmh(f.maxSpeedKmh), unit: 'km/h', tone: 'none', small: false };
  if (id === 'lap') return { label, value: formatLapTime(f.lapElapsedMs, 1), unit: '', tone: 'none', small: false };
  if (id === 'lapno') {
    const on = f.hasState && f.lapNo > 0;
    return { label, value: on ? String(f.lapNo) : '—', unit: on ? '랩' : '', tone: 'none', small: false };
  }
  const i = f.currentSector;
  const d = i === null ? null : (f.sectorDeltas[i] ?? null);
  return { label, value: i === null ? '—' : `S${i + 1} ${formatDelta(d)}`, unit: '', tone: toneOf(d), small: true };
}

/** G값 글자: 좌/우, 가속/제동 */
export function gLabel(gx: number | null, gy: number | null): { lat: string; long: string; latV: string; longV: string } {
  return {
    lat: gy !== null && gy < 0 ? '우' : '좌',
    latV: gy === null ? '—' : Math.abs(gy).toFixed(2),
    long: gx !== null && gx > 0 ? '가속' : '제동',
    longV: gx === null ? '—' : Math.abs(gx).toFixed(2),
  };
}
