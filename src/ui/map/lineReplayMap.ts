// 선 지도 주행·재생 바탕 (사양서 8.4, 8.9, 10.2): 코스·고스트·내 위치는 그 위 캔버스(LiveMap)가 이 지도의 좌표 변환으로 그린다.
// 손 동작은 메인 지도와 같게 지도 프로그램이 직접 받는다 (사용자 요청 2026-11-18 "주행중일땐 여전히 메인지도랑 동작이 다르잖아"):
// 끌기(관성), 두 손가락 확대·돌리기(손가락 기준), 두 손가락 끌기. 두 번 탭은 화면 모드 바꾸기라 확대로 쓰지 않는다.
// 손으로 움직이는 동안 LiveMap 은 따라가기를 멈추고(onUser), 돌아올 때 지금 카메라(camera)에서 시작한다.
// 진행 방향 위 보기는 지도가 스스로 돈다(trackHeading): 지도판을 CSS로 돌리지 않아 지명이 거꾸로 서지 않는다.
import type { LineMapConfig } from './lineMapSupport';
import { boundsOf, newLineMap } from './lineMap';
import { lineZoom } from './lineShapes';
import { FOLLOW_ZOOM, type ReplayMapController } from './mapTypes';

export function createLineReplayMap(el: HTMLElement, cfg: LineMapConfig): ReplayMapController {
  // 지도 출처는 지도가 돌아가도 바로 보이게 바깥(LiveMap)에서 글자로 쓴다
  const map = newLineMap(el, cfg, { interactive: true, rotate: true, doubleTapZoom: false, attribution: false });
  // 손 동작 알림: 닿음 → 손으로 움직임(코드로 옮긴 것은 originalEvent 가 없다) → 다 뗌(관성까지 끝)
  let userCb: ((phase: 'down' | 'moved' | 'up') => void) | null = null;
  let touching = false;
  let moved = false;
  let attached = false;
  const up = () => {
    moved = false;
    userCb?.('up');
  };
  const attach = () => {
    if (attached) return;
    attached = true;
    const box = map.getCanvasContainer();
    const down = () => {
      if (touching) return;
      touching = true;
      userCb?.('down');
    };
    const lift = (e: Event) => {
      const left = (e as Partial<TouchEvent>).touches?.length ?? 0;
      if (!touching || left > 0) return;
      touching = false;
      // 그냥 누르기만 했으면 바로, 움직였으면 관성이 끝날 때(moveend)
      if (!moved) userCb?.('up');
      else if (!map.isMoving()) up();
    };
    box.addEventListener('touchstart', down, { passive: true });
    box.addEventListener('mousedown', down);
    box.addEventListener('touchend', lift, { passive: true });
    box.addEventListener('touchcancel', lift, { passive: true });
    box.addEventListener('mouseup', lift);
    map.on('movestart', (e: { originalEvent?: unknown }) => {
      if (!e?.originalEvent || moved) return;
      moved = true;
      last = '';
      // 마우스 휠처럼 누르지 않고 움직인 것도 손 동작
      if (!touching) userCb?.('down');
      userCb?.('moved');
    });
    map.on('moveend', () => {
      if (moved && !touching) up();
    });
  };
  /** 따라가기 확대 단계 (+ / −·두 손가락으로 바뀐다, 소수) */
  let off = 0;
  /** 전체 코스 보기에서 맞춘 확대 (확대 단계를 더하기 전). 따라가기 중이면 null */
  let fitZoom: number | null = null;
  const Z = () => lineZoom(FOLLOW_ZOOM) + off;
  const pad = (inset: { top: number; bottom: number }) => ({ top: inset.top, bottom: inset.bottom, left: 0, right: 0 });
  let last = '';
  const go = (lat: number, lon: number, bearing: number, inset: { top: number; bottom: number }) => {
    // 같은 자리면 다시 그리지 않는다 (매 프레임 부르므로)
    const key = `${lat.toFixed(7)},${lon.toFixed(7)},${bearing.toFixed(1)},${inset.top},${inset.bottom}`;
    if (key === last && map.getZoom() === Z()) return;
    last = key;
    fitZoom = null;
    map.jumpTo({ center: [lon, lat], zoom: Z(), bearing, padding: pad(inset) });
  };
  return {
    nativeRotate: true,
    fit(points, inset) {
      if (points.length === 0) return;
      map.resize();
      last = '';
      if (points.length === 1) {
        map.jumpTo({ center: [points[0]![1], points[0]![0]], zoom: Z(), bearing: 0, padding: pad(inset) });
        fitZoom = lineZoom(FOLLOW_ZOOM);
      } else {
        map.jumpTo({ bearing: 0 });
        map.fitBounds(boundsOf(points), { padding: { top: 20 + inset.top, bottom: 20 + inset.bottom, left: 20, right: 20 }, maxZoom: lineZoom(18), duration: 0 });
        fitZoom = map.getZoom();
        if (off !== 0) map.jumpTo({ zoom: fitZoom + off });
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
    setZoomOffset(d) {
      off = d;
      last = '';
      // 전체 코스 보기: 맞춘 확대에서 바로 (두 손가락을 따라 매 프레임 불린다). 따라가기는 다음 track 에서
      if (fitZoom !== null) map.jumpTo({ zoom: fitZoom + off });
    },
    project(lat, lon) {
      const p = map.project([lon, lat]);
      return { x: p.x, y: p.y };
    },
    setOnline() {
      // 선 지도는 통신이 돌아오면 알아서 남은 조각을 받는다
    },
    onUser(cb) {
      userCb = cb;
      if (cb) attach();
    },
    camera() {
      const c = map.getCenter();
      return { lat: c.lat, lon: c.lng, zoomOffset: map.getZoom() - lineZoom(FOLLOW_ZOOM), bearing: map.getBearing() };
    },
    zoomBy(d) {
      map.easeTo({ zoom: map.getZoom() + d, duration: 250 });
    },
    destroy() {
      map.remove();
    },
  };
}
