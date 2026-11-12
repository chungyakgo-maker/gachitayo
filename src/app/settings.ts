// 설정 (사양서 8.8 일부): 기본 화면 모드, 상단 표시 값 두 칸, 델타 색. 폰(localStorage)에 보관한다.
import { useSyncExternalStore } from 'react';

export type DriveMode = 'map' | 'minimal' | 'dashboard';
export type WidgetId = 'g' | 'speed' | 'lap' | 'sector' | 'vmax' | 'lapno';
export type DeltaPalette = 'green-red' | 'blue-orange';

export interface Settings {
  defaultMode: DriveMode;
  /** 지도 모드 위쪽에 델타와 함께 보여줄 두 칸 */
  widgets: [WidgetId, WidgetId];
  deltaPalette: DeltaPalette;
}

export const DEFAULT_SETTINGS: Settings = { defaultMode: 'map', widgets: ['g', 'speed'], deltaPalette: 'green-red' };

export const WIDGET_LABEL: Record<WidgetId, string> = {
  g: 'G미터',
  speed: '속도',
  lap: '현재 랩타임',
  sector: '구간 기록',
  vmax: '최고 속도',
  lapno: '랩 번호',
};

const KEY = 'gachitayo.settings';
const MODES: DriveMode[] = ['map', 'minimal', 'dashboard'];
const WIDGETS = Object.keys(WIDGET_LABEL) as WidgetId[];

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
