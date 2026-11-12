// 선 지도 주행·재생 바탕 (사양서 8.4, 8.9, 10.2): 코스·고스트·내 위치는 그 위 캔버스(LiveMap)가 이 지도의 좌표 변환으로 그린다.
// 손으로는 못 움직인다 (두 번 탭으로 모드를 바꾸므로). 진행 방향 위 보기는 지도가 스스로 돈다(trackHeading):
// 지도판을 CSS로 돌리지 않아 지명이 거꾸로 서지 않는다.
import type { LineMapConfig } from './lineMapSupport';
import { boundsOf, newLineMap } from './lineMap';
import { lineZoom } from './lineShapes';
import { FOLLOW_ZOOM, type ReplayMapController } from './mapTypes';

export function createLineReplayMap(el: HTMLElement, cfg: LineMapConfig): ReplayMapController {
  // 지도 출처는 지도가 돌아가도 바로 보이게 바깥(LiveMap)에서 글자로 쓴다
  const map = newLineMap(el, cfg, { interactive: false, attribution: false });
  const Z = lineZoom(FOLLOW_ZOOM);
  const pad = (inset: { top: number; bottom: number }) => ({ top: inset.top, bottom: inset.bottom, left: 0, right: 0 });
  let last = '';
  const go = (lat: number, lon: number, bearing: number, inset: { top: number; bottom: number }) => {
    // 같은 자리면 다시 그리지 않는다 (매 프레임 부르므로)
    const key = `${lat.toFixed(7)},${lon.toFixed(7)},${bearing.toFixed(1)},${inset.top},${inset.bottom}`;
    if (key === last && map.getZoom() === Z) return;
    last = key;
    map.jumpTo({ center: [lon, lat], zoom: Z, bearing, padding: pad(inset) });
  };
  return {
    nativeRotate: true,
    fit(points, inset) {
      if (points.length === 0) return;
      map.resize();
      last = '';
      if (points.length === 1) map.jumpTo({ center: [points[0]![1], points[0]![0]], zoom: Z, bearing: 0, padding: pad(inset) });
      else {
        map.jumpTo({ bearing: 0 });
        map.fitBounds(boundsOf(points), { padding: { top: 20 + inset.top, bottom: 20 + inset.bottom, left: 20, right: 20 }, maxZoom: lineZoom(18), duration: 0 });
      }
    },
    follow(lat, lon, inset) {
      map.resize();
      go(lat, lon, 0, inset);
    },
    centerOn(lat, lon) {
      map.resize();
      go(lat, lon, 0, { top: 0, bottom: 0 });
    },
    track(lat, lon, inset) {
      go(lat, lon, 0, inset);
    },
    trackHeading(lat, lon, bearingDeg, inset) {
      go(lat, lon, bearingDeg, inset);
    },
    resize() {
      map.resize();
      last = '';
    },
    project(lat, lon) {
      const p = map.project([lon, lat]);
      return { x: p.x, y: p.y };
    },
    setOnline() {
      // 선 지도는 통신이 돌아오면 알아서 남은 조각을 받는다
    },
    destroy() {
      map.remove();
    },
  };
}
