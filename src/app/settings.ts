// 설정 (사양서 8.8 일부): 기본 화면 모드, 상단 표시 값 세 칸(칸 1 델타, 칸 2 왼쪽, 칸 3 오른쪽), 델타 색. 폰(localStorage)에 보관한다.
import { useSyncExternalStore } from 'react';
import { G_MAX_DEFAULT, G_MAX_OPTIONS } from '../ui/overlay/gmeter';

export { G_MAX_DEFAULT, G_MAX_OPTIONS };

export type DriveMode = 'map' | 'minimal' | 'dashboard';
/** 상단 칸 2·3에 고를 값. pace 커브 표지판, none 표시 안 함 (사용자 요청) */
export type WidgetId = 'g' | 'pace' | 'speed' | 'lap' | 'sector' | 'vmax' | 'lapno' | 'gap' | 'none';
export type DeltaPalette = 'green-red' | 'blue-orange';
/** 커브 방향 화면 색 (사용자 요청 "abcd 다 넣어 선택할 수 있게"): 끄기, A 화면 전체, B 전체·가까울수록 진하게, C 네 가장자리, D 커브 쪽 가장자리(가까울수록 진하게) */
export type CurveTint = 'off' | 'A' | 'B' | 'C' | 'D';
export const CURVE_TINT_LABEL: Record<CurveTint, string> = { off: '끄기', A: 'A 화면 전체', B: 'B 전체 · 가까울수록 진하게', C: 'C 네 가장자리', D: 'D 커브 쪽 가장자리' };
const CURVE_TINTS = Object.keys(CURVE_TINT_LABEL) as CurveTint[];
/** 주행 지도 모드의 보기 (사용자 요청): 전체 코스 / 나를 가운데(북쪽 위) / 진행 방향 위(내비처럼) */
export type MapViewMode = 'fit' | 'follow' | 'heading';
export const MAP_VIEW_LABEL: Record<MapViewMode, string> = { fit: '전체 코스', follow: '나를 가운데', heading: '진행 방향 위' };

export interface Settings {
  defaultMode: DriveMode;
  /** 지도 모드 위쪽 칸 1(넓은 칸): 델타를 보인다. 끄면 표시 안 함 (사용자 요청) */
  topDelta: boolean;
  /** 칸 1 델타의 기준: 앞 친구를 골랐으면 친구와의 델타(friend) 또는 베스트 대비(best). 친구가 없으면 늘 베스트 (주행 중 칸 1을 눌러 바꾼다) */
  deltaSource: 'friend' | 'best';
  /** 지도 모드 위쪽 칸 2(왼쪽)·칸 3(오른쪽) */
  widgets: [WidgetId, WidgetId];
  deltaPalette: DeltaPalette;
  /** 앞 친구 간격 (M9): 고른 앞 친구와 목표 간격(초, 1초 이상). friendId가 없으면 끔 */
  gap: { friendId: string | null; nickname: string | null; targetS: number };
  /** 새 코스(지도·GPX로 만들 때)의 게이트 폭 m (사양서 8.8). 자동 코스는 엔진 기본값 */
  gateWidthM: number;
  /** 주행 지도 모드의 보기 */
  mapView: MapViewMode;
  /** 주행 중 지도 모드에 바탕 지도(OSM)를 깐다 (사용자 요청). 끄면 코스 선과 점만 그린다 */
  mapTiles: boolean;
  /** G미터 바깥 원 = 이 값 g (사용자 요청: 1.5·2·2.5·3, 기본 2) */
  gMaxG: number;
  /** 주행 지도에 위치를 공유 중인 친구들을 보인다 (사용자 요청: 끌 수 있게) */
  driveFriends: boolean;
  /** 메인 지도에 저장된 코스들을 보인다 (사용자 요청: 지도 위 칩으로 켜고 끈다) */
  mainCourses: boolean;
  /** 커브 방향 화면 색 (사용자 요청 시안 A·B·C·D 중 고름, 기본 D) */
  curveTint: CurveTint;
}

export const GATE_WIDTH_MIN_M = 10;
export const GATE_WIDTH_MAX_M = 60;

export const GAP_MIN_S = 1;
export const GAP_MAX_S = 10;

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'map',
  topDelta: true,
  deltaSource: 'friend',
  widgets: ['g', 'pace'],
  deltaPalette: 'green-red',
  gap: { friendId: null, nickname: null, targetS: 2 },
  gateWidthM: 30,
  mapView: 'fit',
  mapTiles: true,
  gMaxG: G_MAX_DEFAULT,
  driveFriends: true,
  mainCourses: true,
  curveTint: 'D',
};

export const WIDGET_LABEL: Record<WidgetId, string> = {
  g: 'G미터',
  pace: '표지판',
  speed: '속도',
  lap: '현재 랩타임',
  sector: '구간 기록',
  vmax: '최고 속도',
  lapno: '랩 번호',
  gap: '앞 친구 간격',
  none: '표시 안 함',
};

/** 설정 목록에 보이는 상단 칸 요약: "델타 · G미터 · 표지판" */
export const topSummary = (s: Pick<Settings, 'topDelta' | 'widgets'>): string =>
  [s.topDelta ? '델타' : WIDGET_LABEL.none, WIDGET_LABEL[s.widgets[0]], WIDGET_LABEL[s.widgets[1]]].join(' · ');

const KEY = 'gachitayo.settings';
const MODES: DriveMode[] = ['map', 'minimal', 'dashboard'];
const WIDGETS = Object.keys(WIDGET_LABEL) as WidgetId[];

function loadGap(g: unknown): Settings['gap'] {
  const o = (g ?? {}) as Partial<Settings['gap']>;
  const t = typeof o.targetS === 'number' && Number.isFinite(o.targetS) ? Math.min(GAP_MAX_S, Math.max(GAP_MIN_S, Math.round(o.targetS * 2) / 2)) : 2;
  return { friendId: typeof o.friendId === 'string' ? o.friendId : null, nickname: typeof o.nickname === 'string' ? o.nickname : null, targetS: t };
}

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (!raw) return DEFAULT_SETTINGS;
    const w = raw.widgets;
    let widgets: [WidgetId, WidgetId] =
      Array.isArray(w) && w.length === 2 && w.every((x) => WIDGETS.includes(x)) && (w[0] !== w[1] || w[0] === 'none') ? [w[0]!, w[1]!] : DEFAULT_SETTINGS.widgets;
    // 칸 1 설정이 생기기 전에 저장한 값: 속도는 지도 오른쪽 아래로 옮겼으니 속도 칸을 표지판으로 (사용자 요청)
    if (typeof raw.topDelta !== 'boolean' && !widgets.includes('pace')) widgets = widgets.map((x) => (x === 'speed' ? 'pace' : x)) as [WidgetId, WidgetId];
    return {
      defaultMode: MODES.includes(raw.defaultMode as DriveMode) ? raw.defaultMode! : DEFAULT_SETTINGS.defaultMode,
      topDelta: raw.topDelta !== false,
      deltaSource: raw.deltaSource === 'best' ? 'best' : 'friend',
      widgets,
      deltaPalette: raw.deltaPalette === 'blue-orange' ? 'blue-orange' : 'green-red',
      gap: loadGap(raw.gap),
      gateWidthM:
        typeof raw.gateWidthM === 'number' && Number.isFinite(raw.gateWidthM)
          ? Math.min(GATE_WIDTH_MAX_M, Math.max(GATE_WIDTH_MIN_M, Math.round(raw.gateWidthM)))
          : DEFAULT_SETTINGS.gateWidthM,
      mapView: raw.mapView === 'follow' || raw.mapView === 'heading' ? raw.mapView : 'fit',
      mapTiles: raw.mapTiles !== false,
      gMaxG: (G_MAX_OPTIONS as readonly number[]).includes(raw.gMaxG as number) ? raw.gMaxG! : G_MAX_DEFAULT,
      driveFriends: raw.driveFriends !== false,
      mainCourses: raw.mainCourses !== false,
      // 예전 켜기/끄기(true/false)는 D/끄기로
      curveTint: (raw.curveTint as unknown) === false ? 'off' : CURVE_TINTS.includes(raw.curveTint as CurveTint) ? raw.curveTint! : 'D',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export const getSettings = (): Settings => current;

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // 저장할 수 없어도(사생활 보호 모드 등) 이번 실행 동안은 쓴다
  }
  listeners.forEach((l) => l());
}

/** 칸 slot(0 = 칸 2 왼쪽, 1 = 칸 3 오른쪽)에 값 id. 다른 칸과 같으면 두 칸이 서로 바뀐다 (표시 안 함은 두 칸 다 가능) */
export function setWidget(slot: 0 | 1, id: WidgetId): void {
  const w: [WidgetId, WidgetId] = [...current.widgets];
  const other = slot === 0 ? 1 : 0;
  if (id !== 'none' && w[other] === id) w[other] = w[slot];
  w[slot] = id;
  updateSettings({ widgets: w });
}

/** 주행 중 칸 1을 누르면 (사용자 요청): 앞 친구가 있으면 친구 델타 → 베스트 델타 → 표시 안 함, 없으면 델타 ↔ 표시 안 함 */
export function nextTop(s: Pick<Settings, 'topDelta' | 'deltaSource'>, hasFriend: boolean): Pick<Settings, 'topDelta' | 'deltaSource'> {
  if (!s.topDelta) return { topDelta: true, deltaSource: hasFriend ? 'friend' : s.deltaSource };
  if (hasFriend && s.deltaSource === 'friend') return { topDelta: true, deltaSource: 'best' };
  return { topDelta: false, deltaSource: s.deltaSource };
}

/** 주행 중 칸 2·3을 누르면 (사용자 요청): 목록 순서대로 다음 값. 다른 칸의 값, 지금 쓸 수 없는 값(코스 없으면 표지판, 앞 친구 없으면 간격), 표시 안 함은 건너뛴다 */
export function nextWidget(widgets: readonly [WidgetId, WidgetId], slot: 0 | 1, ctx: { hasCourse: boolean; hasFriend: boolean }): [WidgetId, WidgetId] {
  const order: WidgetId[] = WIDGETS.filter((id) => id !== 'none');
  const other = widgets[slot === 0 ? 1 : 0];
  const ok = (id: WidgetId) => id !== other && (id !== 'pace' || ctx.hasCourse) && (id !== 'gap' || ctx.hasFriend);
  const from = order.indexOf(widgets[slot]);
  for (let i = 1; i <= order.length; i++) {
    const id = order[(from + i + order.length) % order.length]!;
    if (ok(id)) {
      const w: [WidgetId, WidgetId] = [widgets[0], widgets[1]];
      w[slot] = id;
      return w;
    }
  }
  return [widgets[0], widgets[1]];
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSettings,
  );
}
