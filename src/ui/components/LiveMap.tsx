// 주행·재생 지도 모드의 지도 (사양서 8.4, 10.2). 바탕 지도(OSM, 설정으로 끔) 위에 코스·고스트·내 위치·친구를 그린다.
// 보기 세 가지: 전체 코스 / 나를 가운데 / 진행 방향 위(지도판을 돌려 내비처럼). 내 위치는 위·아래 칸에 가려지지 않은 영역의 가운데.
//
// 부드럽게 (사용자 요청 "지도가 뚝뚝 끊긴다"): 위치는 1초에 10번 오지만, 지도는 화면 주사율(최대 60번)로 따로 그린다.
// 받은 위치 사이를 시간에 비례해 이어(PoseLerp, 0.1초 늦게) 내 화살표·친구·고스트·지도판이 매 프레임 조금씩 움직인다.
// 위쪽 숫자 칸(React)은 그대로 1초에 10번. 바탕 지도는 매 프레임 다시 맞추지 않고 그만큼만 민다(track).
//
// 두 손가락 (사용자 요청 2026-11-17 "부드럽게 확대·축소가 안 되고 뚝뚝 끊겨", "손으로 지도 회전이 안 돼"):
// 벌리고 오므리는 만큼 매 프레임 확대가 따라가고(+ / − 는 0.25초 동안 스르륵), 비틀면 지도가 돈다.
// 손을 떼면 확대는 설정에(onZoomEnd), 돌린 방위는 주행 화면에(onBearing) 넘긴다 — 손가락이 움직이는 동안은 React를 다시 그리지 않는다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MapViewMode } from '../../app/settings';
import { fromLocal, type LatLon } from '../../engine/geo';
import type { ReplayMapController } from '../map/mapTypes';
import { lineMapConfig } from '../map/lineMapSupport';
import { anchorPadding, drawMiniMap, followView, ME_ANCHOR, type MapModel, type MapView, type MiniMapOpts } from '../overlay/minimap';
import { TwoFingerGesture, upBearing } from '../map/mapGesture';
import type { OverlayFrame } from '../overlay/frame';
import type { OverlayTheme } from '../overlay/theme';
import { PoseLerp, smoothAngleStep } from '../overlay/poseLerp';
import { useElementSize } from '../hooks/useElementSize';

export interface LiveMapProps {
  model: MapModel;
  frame: OverlayFrame;
  origin: LatLon | null;
  th: OverlayTheme;
  /** 지도 위에 얹은 칸이 위·아래에서 가리는 높이 (px) */
  insetTop: number;
  insetBottom: number;
  label: string;
  friend?: MiniMapOpts['friend'];
  friends?: MiniMapOpts['friends'];
  view: MapViewMode;
  /** 바탕 지도(OSM)를 깐다 */
  tiles: boolean;
  /** 나를 가운데 보기(바탕 지도 없을 때)의 보이는 거리를 속도에 맞추려고 */
  speedKmh?: number | null;
  /** 확대 단계 (+ / −, 사용자 요청). 0이 기본, +면 가깝게 */
  zoom?: number;
  /** 내 차 표시 모양 (설정) */
  marker?: MiniMapOpts['marker'];
  /** 손으로 돌린 지도 위쪽 방위 (°). null 이면 보기대로 (진행 방향 위면 자동으로 돈다) */
  bearing?: number | null;
  /** 두 손가락을 뗐을 때 확대 단계 (소수) */
  onZoomEnd?: (zoom: number) => void;
  /** 두 손가락으로 돌렸을 때, 손을 뗀 뒤의 방위 (°) */
  onBearing?: (bearing: number) => void;
}

/** + / − 로 바뀐 확대를 따라가는 빠르기 (ms, 약 0.25초에 거의 다 간다) */
const ZOOM_EASE_MS = 80;

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
/** 120 Hz 화면에서도 60번까지만 그린다 (발열·배터리) */
const MIN_FRAME_MS = 15;

export function LiveMap(props: LiveMapProps) {
  const { model, frame, origin, insetTop, insetBottom, label, view, tiles } = props;
  const zoom = props.zoom ?? 0;
  const box = useElementSize<HTMLDivElement>();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ctl = useRef<ReplayMapController | null>(null);
  const [state, setState] = useState<'off' | 'loading' | 'ready' | 'failed'>(tiles ? 'loading' : 'off');
  // 선 지도는 스스로 돈다 (지도판을 CSS로 돌리지 않아 지명이 거꾸로 서지 않는다)
  const [native, setNative] = useState(false);

  // 받은 위치들 (그릴 때 이어 준다)
  const lerp = useRef({ me: new PoseLerp(), friend: new PoseLerp(), ghost: new PoseLerp() });
  const now0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  lerp.current.me.push(now0, frame.me);
  lerp.current.friend.push(now0, props.friend ?? null);
  lerp.current.ghost.push(now0, frame.ghost);
  const latest = useRef(props);
  latest.current = props;
  const size = useRef({ W: 0, H: 0 });
  size.current = { W: box.width, H: box.height };
  // span: 바탕 지도가 없을 때 속도에 맞춘 보이는 거리 (확대 전), zoom: 지금 그리는 확대 단계(소수), up: 지금 그리는 위쪽 방위
  const smooth = useRef({ head: null as number | null, span: 300, last: 0, drawn: 0, zoom: zoom, applied: NaN, up: null as number | null });
  // 손가락이 움직이는 동안의 값과, 손을 뗀 뒤 설정·주행 화면이 따라올 때까지 쓸 값
  const touch = useRef<{ g: TwoFingerGesture | null; zoom: number | null; bearing: number | null; holdZoom: number | null; holdBearing: number | null }>({
    g: null,
    zoom: null,
    bearing: null,
    holdZoom: null,
    holdBearing: null,
  });

  useEffect(() => {
    if (!tiles) return;
    let alive = true;
    // 새 바탕 지도에는 확대를 다시 넣는다 (그리기가 다음 프레임에)
    smooth.current.applied = NaN;
    // 선 지도(사양서 8.9)를 쓸 수 있으면 그것으로, 아니면 사진 지도로
    void (async () => {
      const cfg = await lineMapConfig();
      if (!alive || !host.current) return;
      if (cfg) {
        try {
          const { createLineReplayMap } = await import('../map/lineReplayMap');
          if (!alive || !host.current) return;
          ctl.current = createLineReplayMap(host.current, cfg);
          setNative(true);
          setState('ready');
          return;
        } catch {
          // 선 지도를 못 띄우면 사진 지도로
        }
      }
      const { createReplayMap } = await import('../map/leafletMap');
      if (!alive || !host.current) return;
      ctl.current = createReplayMap(host.current);
      ctl.current.setOnline(isOnline());
      setState('ready');
    })().catch(() => alive && setState('failed'));
    return () => {
      alive = false;
      ctl.current?.destroy();
      ctl.current = null;
    };
  }, [tiles]);

  // 전체 코스: 코스·보기·크기가 바뀔 때만 맞춘다 (코스가 없으면 지나온 경로가 늘어날 때마다)
  const pathLen = frame.path?.length ?? 0;
  useEffect(() => {
    const c = ctl.current;
    if (state !== 'ready' || !c || !origin || view !== 'fit') return;
    c.resize();
    const local = model.line.length ? model.line : [...(frame.path ?? []), ...(frame.me ? [[frame.me.x, frame.me.y] as const] : [])];
    c.fit(
      local.map(([x, y]) => {
        const ll = fromLocal(origin, x, y);
        return [ll.lat, ll.lon] as [number, number];
      }),
      { top: insetTop, bottom: insetBottom },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, model, origin?.lat, origin?.lon, view, insetTop, insetBottom, model.line.length ? 0 : Math.floor(pathLen / 20), box.width, box.height]);
  useEffect(() => {
    if (state === 'ready') ctl.current?.resize();
  }, [state, box.width, box.height, view]);

  // 진행 방향 위: 돌려도 화면 네 모서리가 다 덮이는 지도판 크기 (돌리는 각도는 매 프레임)
  const W = box.width;
  const H = box.height;
  // 내 위치 자리: 가려지지 않은 영역의 위에서 75% (사용자 요청 "더 아래로, 앞쪽 경로가 더 잘 보이게")
  const vc = insetTop + (H - insetTop - insetBottom) * ME_ANCHOR;
  const D = Math.ceil(2 * Math.hypot(W / 2, Math.max(vc, H - vc))) + 8;
  // 사진 지도만 지도판을 크게 만들어 CSS로 돌린다 (진행 방향 위, 또는 손으로 돌렸을 때)
  const rotating = !native && view !== 'fit' && (view === 'heading' || (props.bearing ?? null) !== null);
  const rotatingRef = useRef(rotating);
  rotatingRef.current = rotating;

  /** 한 프레임 그리기 */
  const drawFrame = (now: number) => {
    const p = latest.current;
    const sm = smooth.current;
    const dt = sm.last ? now - sm.last : 0;
    sm.last = now;
    const { W: w, H: h } = size.current;
    const c = canvas.current;
    if (!c || w <= 0 || h <= 0) return;
    const me = lerp.current.me.sample(now);
    const friend = lerp.current.friend.sample(now);
    const ghost = lerp.current.ghost.sample(now);
    sm.head = smoothAngleStep(sm.head, me?.psi, dt, 250);
    // 확대: 손가락이 움직이는 동안은 그대로 따라가고, + / − 는 스르륵 (계단처럼 뚝 바뀌지 않게)
    const t = touch.current;
    if (t.holdZoom !== null && Math.abs((p.zoom ?? 0) - t.holdZoom) < 0.006) t.holdZoom = null;
    if (t.holdBearing !== null && p.bearing === t.holdBearing) t.holdBearing = null;
    const zoomTarget = t.zoom ?? t.holdZoom ?? p.zoom ?? 0;
    if (t.zoom !== null || dt <= 0 || Math.abs(zoomTarget - sm.zoom) < 0.002) sm.zoom = zoomTarget;
    else sm.zoom += (zoomTarget - sm.zoom) * (1 - Math.exp(-dt / ZOOM_EASE_MS));
    // 위쪽 방위: 손으로 돌리는 중 → 손으로 돌린 값 → 보기대로 (진행 방향 위면 진행 방향)
    const manual = t.bearing ?? t.holdBearing ?? p.bearing ?? null;
    const up = upBearing(p.view, manual, sm.head);
    sm.up = up;
    // 바탕 지도 없을 때 보이는 거리: 속도에 맞추고, 확대 단계만큼 (한 단계 = 두 배)
    const target = 300 + Math.min(100, Math.max(0, (p.speedKmh ?? 0) - 60)) * 5;
    sm.span += (target - sm.span) * (1 - Math.exp(-dt / 1000));
    const spanNow = sm.span * Math.pow(2, -sm.zoom);
    const ins = { top: p.insetTop, bottom: p.insetBottom };
    const vcNow = ins.top + (h - ins.top - ins.bottom) * ME_ANCHOR;
    // 선 지도 카메라 여백: 여백 안 가운데가 내 위치 자리(75%)가 되게
    const pad = anchorPadding(ins, h, ME_ANCHOR);

    let mapView: MapView | undefined;
    const k = ctl.current;
    if (k && state === 'ready' && sm.applied !== sm.zoom) {
      k.setZoomOffset?.(sm.zoom);
      sm.applied = sm.zoom;
    }
    if (p.tiles && k && state === 'ready' && p.origin && k.nativeRotate && k.trackHeading) {
      // 선 지도: 지도가 스스로 돌고, 내 위치는 가려지지 않은 영역 가운데
      if (host.current) host.current.style.transform = '';
      if (p.view !== 'fit' && me) {
        const ll = fromLocal(p.origin, me.x, me.y);
        if (up !== null) k.trackHeading(ll.lat, ll.lon, up, pad);
        else k.track(ll.lat, ll.lon, pad);
      }
      const origin = p.origin;
      mapView = {
        rot: up !== null ? (up * Math.PI) / 180 : 0,
        P: (x, y) => {
          const ll = fromLocal(origin, x, y);
          const q = k.project(ll.lat, ll.lon);
          return [q.x, q.y];
        },
      };
    } else if (p.tiles && k && state === 'ready' && p.origin) {
      // 사진 지도: 지도판을 크게 만들어 둔 때만 CSS로 돌린다
      const turn = up !== null && rotatingRef.current;
      const rotDeg = turn ? -up! : 0;
      if (host.current) host.current.style.transform = turn ? `rotate(${rotDeg}deg)` : '';
      if (p.view !== 'fit' && me) {
        const ll = fromLocal(p.origin, me.x, me.y);
        k.track(ll.lat, ll.lon, turn ? { top: 0, bottom: 0 } : pad);
      }
      const origin = p.origin;
      if (turn) {
        const a = (rotDeg * Math.PI) / 180;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const Dn = Math.ceil(2 * Math.hypot(w / 2, Math.max(vcNow, h - vcNow))) + 8;
        mapView = {
          rot: (up! * Math.PI) / 180,
          P: (x, y) => {
            const ll = fromLocal(origin, x, y);
            const q = k.project(ll.lat, ll.lon);
            const rx = q.x - Dn / 2;
            const ry = q.y - Dn / 2;
            return [w / 2 + rx * ca - ry * sa, vcNow + rx * sa + ry * ca];
          },
        };
      } else {
        mapView = {
          rot: 0,
          P: (x, y) => {
            const ll = fromLocal(origin, x, y);
            const q = k.project(ll.lat, ll.lon);
            return [q.x, q.y];
          },
        };
      }
    } else if (p.view !== 'fit' && me) {
      // 위쪽 방위 → 위를 향하는 진행 방향 ψ (동쪽 기준 반시계)
      mapView = followView(me, w, h, { spanM: spanNow, insetBottom: ins.bottom, top: ins.top, headingUp: up !== null ? ((90 - up) * Math.PI) / 180 : null, anchor: ME_ANCHOR });
    }

    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const fr: OverlayFrame = { ...p.frame, me: me ? { x: me.x, y: me.y, psi: me.psi } : null, ghost: ghost ? { x: ghost.x, y: ghost.y } : null };
    drawMiniMap(ctx, w, h, p.model, fr, p.th, {
      insetBottom: ins.bottom,
      top: ins.top + 20,
      margin: 28,
      view: mapView,
      friend: friend && p.friend ? { ...p.friend, x: friend.x, y: friend.y } : null,
      friends: p.friends,
      north: false,
      marker: p.marker,
    });
  };
  const drawRef = useRef(drawFrame);
  drawRef.current = drawFrame;

  // 화면 주사율로 그린다. requestAnimationFrame이 없는 곳(시험)에서는 다시 그릴 때마다 한 번
  const hasRaf = typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';
  useEffect(() => {
    if (!hasRaf) return;
    let id = 0;
    const tick = (t: number) => {
      if (t - smooth.current.drawn >= MIN_FRAME_MS) {
        smooth.current.drawn = t;
        drawRef.current(t);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [hasRaf]);
  useLayoutEffect(() => {
    if (!hasRaf) drawRef.current(typeof performance !== 'undefined' ? performance.now() : Date.now());
  });

  // 두 손가락: 확대는 늘, 돌리기는 전체 코스 보기가 아닐 때만
  const pts = (e: React.TouchEvent) => [0, 1].map((i) => ({ x: e.touches[i]!.clientX, y: e.touches[i]!.clientY }));
  const onTouchStart = (e: React.TouchEvent) => {
    const t = touch.current;
    if (e.touches.length !== 2) return;
    const [a, b] = pts(e);
    const sm = smooth.current;
    const p = latest.current;
    const up = sm.up ?? upBearing(p.view, t.holdBearing ?? p.bearing ?? null, sm.head) ?? 0;
    t.g = new TwoFingerGesture(a!, b!, { zoom: t.holdZoom ?? p.zoom ?? 0, bearing: p.view === 'fit' ? null : up });
    t.zoom = null;
    t.bearing = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = touch.current;
    if (!t.g || e.touches.length !== 2) return;
    const [a, b] = pts(e);
    const r = t.g.move(a!, b!);
    t.zoom = r.zoom;
    if (r.bearing !== null) t.bearing = r.bearing;
    if (!hasRaf) drawRef.current(typeof performance !== 'undefined' ? performance.now() : Date.now());
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    if (!t.g || e.touches.length >= 2) return;
    const p = latest.current;
    const zoomEnd = t.zoom;
    const bearingEnd = t.g.rotated ? t.bearing : null;
    t.g = null;
    t.zoom = null;
    t.bearing = null;
    // 설정·주행 화면이 새 값을 줄 때까지 이 값을 쓴다 (손을 뗀 순간 예전 값으로 튀지 않게)
    if (zoomEnd !== null && Math.abs(zoomEnd - (p.zoom ?? 0)) >= 0.005) {
      t.holdZoom = zoomEnd;
      p.onZoomEnd?.(zoomEnd);
    }
    if (bearingEnd !== null) {
      t.holdBearing = bearingEnd;
      p.onBearing?.(bearingEnd);
    }
  };

  return (
    <div
      className={tiles ? 'replay-map' : 'live-map'}
      ref={box.ref}
      style={tiles ? undefined : { position: 'absolute', inset: 0 }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {tiles && state !== 'failed' && (
        <div
          ref={host}
          className="leaflet-host"
          style={rotating ? { position: 'absolute', left: W / 2 - D / 2, top: vc - D / 2, width: D, height: D } : { position: 'absolute', inset: 0 }}
        />
      )}
      <canvas ref={canvas} className="overlay-layer" role="img" aria-label={label} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      {tiles && state === 'ready' && isOnline() && (
        <span className="map-attr" style={{ bottom: insetBottom + 6 }}>
          © OpenStreetMap
        </span>
      )}
    </div>
  );
}
