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

/** 한 번만 서버에 묻는다. 통신이 안 돼서 실패하면 다음에 다시 묻는다 */
export function lineMapConfig(apiUrl = serverConfig.apiUrl): Promise<LineMapConfig | null> {
  if (!apiUrl || !hasWebGL()) return Promise.resolve(null);
  probe ??= (async () => {
    const urls = lineMapUrls(apiUrl);
    try {
      const r = await fetch(urls.info);
      if (!r.ok) return null;
      const info = (await r.json()) as { maxZoom?: unknown };
      const maxzoom = typeof info.maxZoom === 'number' && info.maxZoom >= 6 && info.maxZoom <= 16 ? info.maxZoom : 14;
      return { tiles: urls.tiles, glyphs: urls.glyphs, maxzoom };
    } catch {
      probe = null;
      return null;
    }
  })();
  return probe;
}

/** 테스트용 */
export function resetLineMapProbe(): void {
  probe = null;
}
