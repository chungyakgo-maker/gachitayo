// 선 지도를 쓸 수 있는지 (사양서 8.9): 서버 주소가 있고, 폰이 WebGL을 지원하고, 서버에 지도 데이터가 올라가 있어야 한다.
// 하나라도 아니면 예전 사진 지도(Leaflet + OSM 타일)를 쓴다.
import { serverConfig } from '../../server/config';
import { lineMapUrls } from './lineStyle';

export interface LineMapConfig {
  tiles: string;
  glyphs: string;
  maxzoom: number;
}

export function hasWebGL(): boolean {
  // jsdom 등 WebGL이 없는 곳에서는 캔버스를 만들지 않는다
  if (typeof document === 'undefined' || (typeof WebGLRenderingContext === 'undefined' && typeof WebGL2RenderingContext === 'undefined')) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

let probe: Promise<LineMapConfig | null> | null = null;

/** 지도를 쓸 수 있었는지 기억 (사용자 요청 "지도 로딩이 느리다": 다음부터 서버에 묻기 전에 바로 띄운다) */
const MEMORY_KEY = 'gachitayo.lineMap.v1';
interface Memory {
  apiUrl: string;
  maxzoom: number;
}
function remembered(apiUrl: string): number | null {
  try {
    const m = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? 'null') as Memory | null;
    return m && m.apiUrl === apiUrl && typeof m.maxzoom === 'number' ? m.maxzoom : null;
  } catch {
    return null;
  }
}
function remember(apiUrl: string, maxzoom: number | null): void {
  try {
    if (maxzoom === null) localStorage.removeItem(MEMORY_KEY);
    else localStorage.setItem(MEMORY_KEY, JSON.stringify({ apiUrl, maxzoom } satisfies Memory));
  } catch {
    // 저장소를 못 쓰면 매번 묻는다
  }
}

/** 서버에 지도 데이터가 있는지 묻는다. 있으면 확대 한도, 없으면(404) null, 통신 실패면 undefined */
async function ask(apiUrl: string): Promise<number | null | undefined> {
  try {
    const r = await fetch(lineMapUrls(apiUrl).info);
    if (!r.ok) return null;
    const info = (await r.json()) as { maxZoom?: unknown };
    return typeof info.maxZoom === 'number' && info.maxZoom >= 6 && info.maxZoom <= 16 ? info.maxZoom : 14;
  } catch {
    return undefined;
  }
}

const config = (apiUrl: string, maxzoom: number): LineMapConfig => {
  const urls = lineMapUrls(apiUrl);
  return { tiles: urls.tiles, glyphs: urls.glyphs, maxzoom };
};

/**
 * 한 번만 서버에 묻는다. 전에 쓸 수 있었으면 묻지 않고 바로(통신이 없어도 폰에 보관한 조각으로) 쓰고, 뒤에서 다시 확인해
 * 서버에 지도가 없어졌으면 다음부터 사진 지도로. 처음이고 통신이 안 돼서 실패하면 다음에 다시 묻는다
 */
export function lineMapConfig(apiUrl = serverConfig.apiUrl): Promise<LineMapConfig | null> {
  if (!apiUrl || !hasWebGL()) return Promise.resolve(null);
  probe ??= (async () => {
    const known = remembered(apiUrl);
    if (known !== null) {
      void ask(apiUrl).then((z) => {
        if (z !== undefined) remember(apiUrl, z);
      });
      return config(apiUrl, known);
    }
    const z = await ask(apiUrl);
    if (z === undefined) {
      probe = null;
      return null;
    }
    remember(apiUrl, z);
    return z === null ? null : config(apiUrl, z);
  })();
  return probe;
}

/** 테스트용 */
export function resetLineMapProbe(forget = false): void {
  probe = null;
  if (forget) {
    try {
      localStorage.removeItem(MEMORY_KEY);
    } catch {
      // 없음
    }
  }
}
