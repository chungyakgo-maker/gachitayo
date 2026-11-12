// 주행·재생 지도 모드의 지도 (사양서 8.4, 10.2). 바탕 지도(OSM, 설정으로 끔) 위에 코스·고스트·내 위치·친구를 그린다.
// 보기 세 가지: 전체 코스 / 나를 가운데 / 진행 방향 위(지도판을 돌려 내비처럼). 내 위치는 위·아래 칸에 가려지지 않은 영역의 가운데.
//
// 부드럽게 (사용자 요청 "지도가 뚝뚝 끊긴다"): 위치는 1초에 10번 오지만, 지도는 화면 주사율(최대 60번)로 따로 그린다.
// 받은 위치 사이를 시간에 비례해 이어(PoseLerp, 0.1초 늦게) 내 화살표·친구·고스트·지도판이 매 프레임 조금씩 움직인다.
// 위쪽 숫자 칸(React)은 그대로 1초에 10번. 바탕 지도는 매 프레임 다시 맞추지 않고 그만큼만 민다(track).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MapViewMode } from '../../app/settings';
import { fromLocal, type LatLon } from '../../engine/geo';
import type { ReplayMapController } from '../map/mapTypes';
import { lineMapConfig } from '../map/lineMapSupport';
import { headingToBearing } from '../map/lineShapes';
import { drawMiniMap, followView, type MapModel, type MapView, type MiniMapOpts } from '../overlay/minimap';
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
}

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
/** 120 Hz 화면에서도 60번까지만 그린다 (발열·배터리) */
const MIN_FRAME_MS = 15;

export function LiveMap(props: LiveMapProps) {
  const { model, frame, origin, insetTop, insetBottom, label, view, tiles } = props;
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
  const smooth = useRef({ head: null as number | null, span: 300, last: 0, drawn: 0 });

  useEffect(() => {
    if (!tiles) return;
    let alive = true;
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
  const vc = insetTop + (H - insetTop - insetBottom) / 2;
  const D = Math.ceil(2 * Math.hypot(W / 2, Math.max(vc, H - vc))) + 8;
  // 사진 지도만 지도판을 크게 만들어 CSS로 돌린다
  const rotating = view === 'heading' && !native;

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
    const target = 300 + Math.min(100, Math.max(0, (p.speedKmh ?? 0) - 60)) * 5;
    sm.span += (target - sm.span) * (1 - Math.exp(-dt / 1000));
    const ins = { top: p.insetTop, bottom: p.insetBottom };
    const vcNow = ins.top + (h - ins.top - ins.bottom) / 2;

    let mapView: MapView | undefined;
    const k = ctl.current;
    if (p.tiles && k && state === 'ready' && p.origin && k.nativeRotate && k.trackHeading) {
      // 선 지도: 지도가 스스로 돌고, 내 위치는 가려지지 않은 영역 가운데
      const turn = p.view === 'heading' && sm.head !== null;
      if (host.current) host.current.style.transform = '';
      if (p.view !== 'fit' && me) {
        const ll = fromLocal(p.origin, me.x, me.y);
        if (turn) k.trackHeading(ll.lat, ll.lon, headingToBearing(sm.head!), ins);
        else k.track(ll.lat, ll.lon, ins);
      }
      const origin = p.origin;
      mapView = {
        rot: turn ? Math.PI / 2 - sm.head! : 0,
        P: (x, y) => {
          const ll = fromLocal(origin, x, y);
          const q = k.project(ll.lat, ll.lon);
          return [q.x, q.y];
        },
      };
    } else if (p.tiles && k && state === 'ready' && p.origin) {
      const turn = p.view === 'heading' && sm.head !== null;
      const rotDeg = turn ? -(90 - (sm.head! * 180) / Math.PI) : 0;
      if (host.current) host.current.style.transform = turn ? `rotate(${rotDeg}deg)` : '';
      if (p.view !== 'fit' && me) {
        const ll = fromLocal(p.origin, me.x, me.y);
        k.track(ll.lat, ll.lon, turn ? { top: 0, bottom: 0 } : ins);
      }
      const origin = p.origin;
      if (turn) {
        const a = (rotDeg * Math.PI) / 180;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const Dn = Math.ceil(2 * Math.hypot(w / 2, Math.max(vcNow, h - vcNow))) + 8;
        mapView = {
          rot: Math.PI / 2 - sm.head!,
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
      mapView = followView(me, w, h, { spanM: sm.span, insetBottom: ins.bottom, top: ins.top, headingUp: p.view === 'heading' ? sm.head : null });
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
      friend: friend && p.friend ? { x: friend.x, y: friend.y, label: p.friend.label } : null,
      friends: p.friends,
      north: false,
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

  return (
    <div className={tiles ? 'replay-map' : 'live-map'} ref={box.ref} style={tiles ? undefined : { position: 'absolute', inset: 0 }}>
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
