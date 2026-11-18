// 주행·재생 지도 모드의 지도 (사양서 8.4, 10.2). 바탕 지도(OSM, 설정으로 끔) 위에 코스·고스트·내 위치·친구를 그린다.
// 보기 세 가지: 전체 코스 / 나를 가운데 / 진행 방향 위(지도판을 돌려 내비처럼). 내 위치는 위·아래 칸에 가려지지 않은 영역의 가운데.
//
// 부드럽게 (사용자 요청 "지도가 뚝뚝 끊긴다"): 위치는 1초에 10번 오지만, 지도는 화면 주사율(최대 60번)로 따로 그린다.
// 받은 위치 사이를 시간에 비례해 이어(PoseLerp, 0.1초 늦게) 내 화살표·친구·고스트·지도판이 매 프레임 조금씩 움직인다.
// 위쪽 숫자 칸(React)은 그대로 1초에 10번. 바탕 지도는 매 프레임 다시 맞추지 않고 그만큼만 민다(track).
//
// 두 손가락 (사용자 요청 2026-11-17 "부드럽게 확대·축소가 안 되고 뚝뚝 끊겨", "손으로 지도 회전이 안 돼"):
// 벌리고 오므리는 만큼 매 프레임 확대가 따라가고(+ / − 는 0.25초 동안 스르륵), 비틀면 지도가 돈다.
// 2026-11-18 "주행중일땐 여전히 메인지도랑 동작이 다르잖아": 선 지도는 메인 지도와 같은 지도 프로그램이 손 동작을 직접 받는다
// (끌기·관성, 손가락 기준 확대·돌리기, 두 손가락 끌기). 손가락이 닿아 있는 동안은 따라가기를 멈추고, 손으로 움직이면 둘러보기
// ("내 위치로"), 다 떼고 3초 뒤 지금 카메라에서 내 위치·평소 주행 확대·보기대로 방위로 스르륵 돌아온다.
// 바탕 지도 없이 그릴 때(선 지도가 아닐 때)는 같은 규칙을 여기서 손가락으로 흉내 낸다. 손가락이 움직이는 동안은 React를 다시 그리지 않는다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MapViewMode } from '../../app/settings';
import { fromLocal, toLocal, type LatLon } from '../../engine/geo';
import type { ReplayMapController } from '../map/mapTypes';
import { lineMapConfig } from '../map/lineMapSupport';
import { anchorPadding, drawMiniMap, followView, ME_ANCHOR, type MapModel, type MapView, type MiniMapOpts } from '../overlay/minimap';
import { screenToLocal, TwoFingerGesture, upBearing } from '../map/mapGesture';
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
  /** 손으로 움직여 내 위치를 따라가지 않는지 (2026-11-18 "메인·주행 똑같이"): true 면 GPS 버튼이 "내 위치로" */
  onAway?: (away: boolean) => void;
  /** 바뀔 때마다 내 위치로 돌아온다 (GPS 버튼 / "내 위치로") */
  recenter?: number;
  /** 둘러보는 중의 + / − (확대는 잠깐만, 저장 안 함): seq 가 바뀔 때마다 d 단계 */
  zoomNudge?: { seq: number; d: number } | null;
}

/** 끌어 둔 지도가 저절로 내 위치로 돌아오기까지 (사용자 결정 "3초") */
export const AUTO_RETURN_MS = 3000;
/** 손가락이 이만큼(px) 움직여야 끌기로 본다 (살짝 누른 것과 구별) */
const PAN_START_PX = 8;
/** 내 위치로 돌아오는 시간 */
const RETURN_MS = 350;
const ease = (k: number) => 1 - Math.pow(1 - k, 3);
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

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
  // view: 마지막에 그린 지도 변환 (끈 만큼 옮길 때), cp: 마지막 카메라 가운데 (평면 m)
  const smooth = useRef({
    head: null as number | null,
    span: 300,
    last: 0,
    drawn: 0,
    zoom: zoom,
    applied: NaN,
    up: null as number | null,
    view: null as MapView | null,
    cp: null as { x: number; y: number } | null,
  });
  // 손가락이 움직이는 동안의 값과, 손을 뗀 뒤 설정·주행 화면이 따라올 때까지 쓸 값.
  // free: 끌어서 둘러보는 중의 카메라 가운데 (내 위치를 따라가지 않음), freeZoom·freeBearing: 둘러보는 중에만 쓰는 확대·방위,
  // ret: 내 위치로 돌아오는 중 (시작 자리·시각), upAnim: 방위가 바뀔 때 스르륵 (시작 방위·시각)
  const touch = useRef({
    g: null as TwoFingerGesture | null,
    zoom: null as number | null,
    bearing: null as number | null,
    /** 선 지도: 손가락이 닿아 있음 (따라가기를 멈춘다) / 손으로 움직여 둘러보는 중 */
    hold: false,
    nativeFree: false,
    /** 두 손가락 시작 확대·가운데 (흉내 낼 때: 움직였는지·두 손가락 끌기) */
    gz0: 0,
    mid: null as { x: number; y: number } | null,
    pan: null as { x: number; y: number; moving: boolean } | null,
    free: null as { x: number; y: number } | null,
    freeZoom: null as number | null,
    freeBearing: null as number | null,
    timer: null as ReturnType<typeof setTimeout> | null,
    ret: null as { x: number; y: number; t0: number } | null,
    upAnim: null as { from: number; t0: number } | null,
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
  // 전체 코스 보기에서 손으로 옮겼다가 돌아오면 다시 맞춘다
  const [refit, setRefit] = useState(0);
  useEffect(() => {
    const c = ctl.current;
    if (state !== 'ready' || !c || !origin || view !== 'fit') return;
    // 손으로 둘러보는 중에는 맞추지 않는다
    if (touch.current.hold || touch.current.nativeFree) return;
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
  }, [state, model, origin?.lat, origin?.lon, view, insetTop, insetBottom, model.line.length ? 0 : Math.floor(pathLen / 20), box.width, box.height, refit]);
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
  const rotating = !native && view === 'heading';
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
    const zoomTarget = t.zoom ?? (t.free ? t.freeZoom : null) ?? p.zoom ?? 0;
    if (t.zoom !== null || dt <= 0 || Math.abs(zoomTarget - sm.zoom) < 0.002) sm.zoom = zoomTarget;
    else sm.zoom += (zoomTarget - sm.zoom) * (1 - Math.exp(-dt / ZOOM_EASE_MS));
    // 위쪽 방위: 둘러보는 중이면 그때 방위, 아니면 보기대로 (진행 방향 위면 진행 방향). 돌아올 때는 스르륵
    const manual = t.free ? (t.bearing ?? t.freeBearing ?? 0) : null;
    let up = upBearing(p.view, manual, sm.head);
    if (t.upAnim) {
      const k = Math.min(1, Math.max(0, (now - t.upAnim.t0) / RETURN_MS));
      if (k >= 1) t.upAnim = null;
      else up = (((t.upAnim.from + wrap180((up ?? 0) - t.upAnim.from) * ease(k)) % 360) + 360) % 360;
    }
    sm.up = up;
    // 카메라 가운데: 둘러보는 중이면 끌어 둔 곳, 돌아오는 중이면 그곳에서 내 위치로, 아니면 내 위치
    let cp: { x: number; y: number } | null = me;
    if (t.free) cp = t.free;
    else if (t.ret && me) {
      const k = Math.min(1, Math.max(0, (now - t.ret.t0) / RETURN_MS));
      cp = { x: t.ret.x + (me.x - t.ret.x) * ease(k), y: t.ret.y + (me.y - t.ret.y) * ease(k) };
      if (k >= 1) t.ret = null;
    }
    sm.cp = cp ? { x: cp.x, y: cp.y } : null;
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
    // 선 지도에 손가락이 닿아 있거나 손으로 둘러보는 중이면 카메라는 사용자 것 (따라가기·확대를 넣지 않는다)
    const userOwns = t.hold || t.nativeFree;
    if (k && state === 'ready' && sm.applied !== sm.zoom && !userOwns) {
      k.setZoomOffset?.(sm.zoom);
      sm.applied = sm.zoom;
    }
    if (p.tiles && k && state === 'ready' && p.origin && k.nativeRotate && k.trackHeading) {
      // 선 지도: 지도가 스스로 돌고, 내 위치는 가려지지 않은 영역 가운데
      if (host.current) host.current.style.transform = '';
      if (p.view !== 'fit' && cp && !userOwns) {
        const ll = fromLocal(p.origin, cp.x, cp.y);
        if (up !== null) k.trackHeading(ll.lat, ll.lon, up, pad);
        else k.track(ll.lat, ll.lon, pad);
      }
      const origin = p.origin;
      const shownUp = userOwns ? (k.camera?.().bearing ?? 0) : up;
      mapView = {
        rot: shownUp !== null ? (shownUp * Math.PI) / 180 : 0,
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
      if (p.view !== 'fit' && cp) {
        const ll = fromLocal(p.origin, cp.x, cp.y);
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
    } else if (p.view !== 'fit' && cp) {
      // 위쪽 방위 → 위를 향하는 진행 방향 ψ (동쪽 기준 반시계)
      mapView = followView(cp, w, h, { spanM: spanNow, insetBottom: ins.bottom, top: ins.top, headingUp: up !== null ? ((90 - up) * Math.PI) / 180 : null, anchor: ME_ANCHOR });
    }

    sm.view = mapView ?? null;
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

  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const redraw = () => {
    if (!hasRaf) drawRef.current(nowMs());
  };
  const clearTimer = () => {
    const t = touch.current;
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
  };
  const later = () => {
    clearTimer();
    touch.current.timer = setTimeout(() => goBackRef.current(), AUTO_RETURN_MS);
  };
  /** 손으로 움직이기 시작: 내 위치 따라가기를 멈추고 지금 보이는 확대·방위를 그대로 둔다 */
  const enterFree = () => {
    const t = touch.current;
    const sm = smooth.current;
    if (t.free) return;
    const c = sm.cp ?? latest.current.frame.me ?? { x: 0, y: 0 };
    t.free = { x: c.x, y: c.y };
    t.ret = null;
    t.upAnim = null;
    t.freeZoom = sm.zoom;
    t.freeBearing = sm.up;
    latest.current.onAway?.(true);
  };
  /** 내 위치로: 위치는 스르륵, 확대는 평소 주행 크기, 방위는 보기대로 (둘러보며 바꾼 것은 버린다) */
  const goBack = () => {
    const t = touch.current;
    const sm = smooth.current;
    clearTimer();
    const now = nowMs();
    if (t.nativeFree) {
      // 선 지도: 손으로 옮겨 둔 지금 카메라에서 시작해 돌아온다
      t.nativeFree = false;
      t.hold = false;
      const cam = ctl.current?.camera?.();
      const o = latest.current.origin;
      if (cam && o) {
        const l = toLocal(o, cam.lat, cam.lon);
        t.ret = { x: l.x, y: l.y, t0: now };
        t.upAnim = { from: cam.bearing, t0: now };
        sm.zoom = cam.zoomOffset;
        sm.applied = NaN;
      }
      latest.current.onAway?.(false);
      if (latest.current.view === 'fit') setRefit((n) => n + 1);
      redraw();
      return;
    }
    if (!t.free) return;
    t.ret = { x: t.free.x, y: t.free.y, t0: now };
    t.upAnim = { from: sm.up ?? 0, t0: now };
    t.free = null;
    t.freeZoom = null;
    t.freeBearing = null;
    latest.current.onAway?.(false);
    redraw();
  };
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  // GPS 버튼 / "내 위치로" (처음 그릴 때는 아님)
  const recenterSeen = useRef(props.recenter);
  useEffect(() => {
    if (props.recenter === recenterSeen.current) return;
    recenterSeen.current = props.recenter;
    goBackRef.current();
  }, [props.recenter]);
  // 둘러보는 중의 + / −: 잠깐만 (저장 안 함). 선 지도는 지도가 스르륵
  const nudgeSeen = useRef(props.zoomNudge?.seq);
  useEffect(() => {
    const n = props.zoomNudge;
    if (!n || n.seq === nudgeSeen.current) return;
    nudgeSeen.current = n.seq;
    const t = touch.current;
    if (t.nativeFree) ctl.current?.zoomBy?.(n.d);
    else if (t.free) t.freeZoom = Math.min(2, Math.max(-4, (t.freeZoom ?? smooth.current.zoom) + n.d));
  }, [props.zoomNudge]);
  useEffect(() => () => clearTimer(), []);

  // 선 지도: 손 동작은 지도가 직접 받고 (메인 지도와 같게), 여기서는 따라가기 멈춤·둘러보기·3초 뒤 돌아오기만
  const onUser = (phase: 'down' | 'moved' | 'up') => {
    const t = touch.current;
    if (phase === 'down') {
      clearTimer();
      t.hold = true;
      return;
    }
    if (phase === 'moved') {
      clearTimer();
      t.hold = true;
      if (!t.nativeFree) {
        t.nativeFree = true;
        t.ret = null;
        t.upAnim = null;
        latest.current.onAway?.(true);
      }
      return;
    }
    t.hold = false;
    if (t.nativeFree) later();
  };
  const onUserRef = useRef(onUser);
  onUserRef.current = onUser;
  useEffect(() => {
    const k = ctl.current;
    if (state !== 'ready' || !native || !k?.onUser) return;
    k.onUser((ph) => onUserRef.current(ph));
    return () => k.onUser?.(null);
  }, [state, native]);
  /** 선 지도가 손 동작을 받는 중이면 아래 흉내는 쓰지 않는다 */
  const mapTakesTouch = () => latest.current.tiles && state === 'ready' && native;

  // 바탕 지도 없이 그릴 때(사진 지도 포함): 메인 지도처럼 흉내 낸다. 한 손가락 끌기, 두 손가락 확대·돌리기·끌기.
  // 움직이면 둘러보기("내 위치로"), 다 떼고 3초 뒤 돌아오기. 전체 코스 보기는 확대만
  const pts = (e: React.TouchEvent) => [0, 1].map((i) => ({ x: e.touches[i]!.clientX, y: e.touches[i]!.clientY }));
  const onTouchStart = (e: React.TouchEvent) => {
    if (mapTakesTouch()) return;
    const t = touch.current;
    clearTimer();
    const p = latest.current;
    if (e.touches.length === 1) {
      t.pan = p.view === 'fit' ? null : { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, moving: false };
      return;
    }
    t.pan = null;
    if (e.touches.length !== 2) return;
    const [a, b] = pts(e);
    const sm = smooth.current;
    const up = sm.up ?? upBearing(p.view, null, sm.head) ?? 0;
    const z0 = t.free ? (t.freeZoom ?? sm.zoom) : sm.zoom;
    t.g = new TwoFingerGesture(a!, b!, { zoom: z0, bearing: p.view === 'fit' ? null : up });
    t.gz0 = z0;
    t.mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
    t.zoom = null;
    t.bearing = null;
  };
  /** 손가락을 따라 지도 그림이 움직인다 = 카메라는 반대로 */
  const shift = (dx: number, dy: number) => {
    const t = touch.current;
    const v = smooth.current.view;
    if (!t.free || !v || latest.current.view === 'fit') return;
    const [lx, ly] = screenToLocal(v.P, [t.free.x, t.free.y], -dx, -dy);
    t.free = { x: t.free.x + lx, y: t.free.y + ly };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (mapTakesTouch()) return;
    const t = touch.current;
    if (e.touches.length === 1 && t.pan) {
      const x = e.touches[0]!.clientX;
      const y = e.touches[0]!.clientY;
      const dx = x - t.pan.x;
      const dy = y - t.pan.y;
      if (!t.pan.moving) {
        if (Math.hypot(dx, dy) < PAN_START_PX) return;
        t.pan.moving = true;
        enterFree();
      }
      shift(dx, dy);
      t.pan.x = x;
      t.pan.y = y;
      redraw();
      return;
    }
    if (!t.g || e.touches.length !== 2) return;
    const [a, b] = pts(e);
    const r = t.g.move(a!, b!);
    // 확대·돌리기도 메인 지도처럼 둘러보기 (평소 주행 크기는 + / − 로 정한다)
    if (!t.free && (Math.abs(r.zoom - t.gz0) > 0.02 || r.bearing !== null)) enterFree();
    if (!t.free) return;
    t.zoom = r.zoom;
    if (r.bearing !== null) t.bearing = r.bearing;
    const m = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
    if (t.mid) shift(m.x - t.mid.x, m.y - t.mid.y);
    t.mid = m;
    redraw();
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (mapTakesTouch()) return;
    const t = touch.current;
    if (e.touches.length === 0) t.pan = null;
    if (t.g && e.touches.length < 2) {
      const zoomEnd = t.zoom;
      const bearingEnd = t.g.rotated ? t.bearing : null;
      t.g = null;
      t.zoom = null;
      t.bearing = null;
      t.mid = null;
      if (t.free) {
        // 둘러보는 중: 확대·방위는 잠깐만 (돌아오면 평소대로)
        if (zoomEnd !== null) t.freeZoom = zoomEnd;
        if (bearingEnd !== null) t.freeBearing = bearingEnd;
      }
    }
    // 손을 다 떼고 3초 동안 안 대면 저절로 내 위치로 (사용자 결정)
    if (e.touches.length === 0 && t.free) later();
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
      {/* 그림은 손가락을 아래 지도로 넘긴다 (선 지도가 메인 지도처럼 손 동작을 직접 받게) */}
      <canvas ref={canvas} className="overlay-layer" role="img" aria-label={label} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />
      {tiles && state === 'ready' && isOnline() && (
        <span className="map-attr" style={{ bottom: insetBottom + 6 }}>
          © OpenStreetMap
        </span>
      )}
    </div>
  );
}
