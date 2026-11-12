// 설정 (사양서 8.8 일부): 기본 화면 모드, 상단 표시 값 두 칸, 델타 색. 폰(localStorage)에 보관한다.
import { useSyncExternalStore } from 'react';
import { G_MAX_DEFAULT, G_MAX_OPTIONS } from '../ui/overlay/gmeter';

export { G_MAX_DEFAULT, G_MAX_OPTIONS };

export type DriveMode = 'map' | 'minimal' | 'dashboard';
export type WidgetId = 'g' | 'speed' | 'lap' | 'sector' | 'vmax' | 'lapno' | 'gap';
export type DeltaPalette = 'green-red' | 'blue-orange';
/** 주행 지도 모드의 보기 (사용자 요청): 전체 코스 / 나를 가운데(북쪽 위) / 진행 방향 위(내비처럼) */
export type MapViewMode = 'fit' | 'follow' | 'heading';
export const MAP_VIEW_LABEL: Record<MapViewMode, string> = { fit: '전체 코스', follow: '나를 가운데', heading: '진행 방향 위' };

export interface Settings {
  defaultMode: DriveMode;
  /** 지도 모드 위쪽에 델타와 함께 보여줄 두 칸 */
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
}

export const GATE_WIDTH_MIN_M = 10;
export const GATE_WIDTH_MAX_M = 60;

export const GAP_MIN_S = 1;
export const GAP_MAX_S = 10;

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'map',
  widgets: ['g', 'speed'],
  deltaPalette: 'green-red',
  gap: { friendId: null, nickname: null, targetS: 2 },
  gateWidthM: 30,
  mapView: 'fit',
  mapTiles: true,
  gMaxG: G_MAX_DEFAULT,
  driveFriends: true,
};

export const WIDGET_LABEL: Record<WidgetId, string> = {
  g: 'G미터',
  speed: '속도',
  lap: '현재 랩타임',
  sector: '구간 기록',
  vmax: '최고 속도',
  lapno: '랩 번호',
  gap: '앞 친구 간격',
};

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
    return {
      defaultMode: MODES.includes(raw.defaultMode as DriveMode) ? raw.defaultMode! : DEFAULT_SETTINGS.defaultMode,
      widgets:
        Array.isArray(w) && w.length === 2 && w.every((x) => WIDGETS.includes(x)) && w[0] !== w[1]
          ? [w[0]!, w[1]!]
          : DEFAULT_SETTINGS.widgets,
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

/** 칸 slot에 값 id. 다른 칸과 같으면 두 칸이 서로 바뀐다 */
export function setWidget(slot: 0 | 1, id: WidgetId): void {
  const w: [WidgetId, WidgetId] = [...current.widgets];
  const other = slot === 0 ? 1 : 0;
  if (w[other] === id) w[other] = w[slot];
  w[slot] = id;
  updateSettings({ widgets: w });
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
