// 지도 모드 지도 (사용자 요청): OpenStreetMap 지도 위에 코스·고스트·내 위치를 그린다. 재생과 주행(설정에서 켰을 때) 모두 쓴다.
// 보기 세 가지: 전체 코스(화면을 꽉 채우게) / 나를 가운데(북쪽 위, 가깝게) / 진행 방향 위(지도판을 돌려 내비처럼).
// 보기는 주행 화면 왼쪽 위 나침반 버튼으로 바꾼다 (재생·주행 같음).
// 지도를 불러오지 못하면 타일 없는 미니맵으로 그린다.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MapViewMode } from '../../app/settings';
import { useElementSize } from '../hooks/useElementSize';
import { fromLocal, type LatLon } from '../../engine/geo';
import type { ReplayMapController } from '../map/leafletMap';
import { drawMiniMap, type MapModel, type MapView, type MiniMapOpts } from '../overlay/minimap';
import type { OverlayFrame } from '../overlay/frame';
import type { OverlayTheme } from '../overlay/theme';
import { OverlayCanvas } from './OverlayCanvas';

export type ReplayView = MapViewMode;

export interface ReplayMapProps {
  model: MapModel;
  frame: OverlayFrame;
  origin: LatLon | null;
  th: OverlayTheme;
  insetBottom: number;
  label: string;
  friend?: MiniMapOpts['friend'];
  friends?: MiniMapOpts['friends'];
  /** 부드럽게 한 진행 방향 (진행 방향 위 보기) */
  heading?: number | null;
  /** 보기 (주행 화면의 나침반 버튼이 정한다) */
  view: MapViewMode;
}

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export function ReplayMap({ model, frame, origin, th, insetBottom, label, friend, friends, heading = null, view }: ReplayMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const ctl = useRef<ReplayMapController | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const box = useElementSize<HTMLDivElement>();

  useEffect(() => {
    let alive = true;
    import('../map/leafletMap')
      .then(({ createReplayMap }) => {
        if (!alive || !el.current) return;
        ctl.current = createReplayMap(el.current);
        ctl.current.setOnline(isOnline());
        setState('ready');
      })
      .catch(() => alive && setState('failed'));
    return () => {
      alive = false;
      ctl.current?.destroy();
      ctl.current = null;
    };
  }, []);

  // 전체 코스: 코스가 바뀌거나 이 보기로 돌아올 때 (코스가 없으면 지나온 경로가 늘어날 때마다)
  const pathLen = frame.path?.length ?? 0;
  useEffect(() => {
    const c = ctl.current;
    if (state !== 'ready' || !c || !origin || view !== 'fit') return;
    const local = model.line.length ? model.line : [...(frame.path ?? []), ...(frame.me ? [[frame.me.x, frame.me.y] as const] : [])];
    c.fit(
      local.map(([x, y]) => {
        const ll = fromLocal(origin, x, y);
        return [ll.lat, ll.lon] as [number, number];
      }),
      insetBottom,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, model, origin?.lat, origin?.lon, view, insetBottom, model.line.length ? 0 : Math.floor(pathLen / 20), box.width, box.height]);

  // 진행 방향 위: 지도판을 대각선 크기로 키워 내 위치(보이는 곳 가운데)에 두고, 진행 방향이 위로 오게 돌린다
  const psi = heading ?? frame.me?.psi ?? null;
  const rotating = view === 'heading' && psi !== null;
  const W = box.width;
  const H = box.height;
  const vc = (H - insetBottom) / 2;
  const D = Math.ceil(Math.hypot(W, H)) + 8;
  const rotDeg = rotating ? -(90 - (psi! * 180) / Math.PI) : 0;

  if (state === 'ready' && frame.me && origin && view !== 'fit') {
    const ll = fromLocal(origin, frame.me.x, frame.me.y);
    if (rotating) ctl.current?.centerOn(ll.lat, ll.lon);
    else ctl.current?.follow(ll.lat, ll.lon, insetBottom);
  }

  // 평면 좌표 → 화면 좌표. 위도는 y에만, 경도는 x에만 달려 있어(fromLocal, 북쪽이 위) 축마다 바꾼 뒤, 돌렸으면 같이 돌린다
  const c = ctl.current;
  let mapView: MapView | undefined;
  if (state === 'ready' && origin && c) {
    if (rotating) {
      const a = (rotDeg * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      mapView = {
        rot: Math.PI / 2 - psi!,
        P: (x, y) => {
          const ll = fromLocal(origin, x, y);
          const p = c.project(ll.lat, ll.lon);
          const rx = p.x - D / 2;
          const ry = p.y - D / 2;
          return [W / 2 + rx * ca - ry * sa, vc + rx * sa + ry * ca];
        },
      };
    } else {
      mapView = {
        rot: 0,
        P: (x, y) => {
          const ll = fromLocal(origin, x, y);
          const p = c.project(ll.lat, ll.lon);
          return [p.x, p.y];
        },
      };
    }
  }

  const hostStyle: CSSProperties = rotating
    ? { position: 'absolute', left: W / 2 - D / 2, top: vc - D / 2, width: D, height: D, transform: `rotate(${rotDeg}deg)` }
    : { position: 'absolute', inset: 0 };

  return (
    <div className="replay-map" ref={box.ref}>
      {state !== 'failed' && <div ref={el} className="leaflet-host" style={hostStyle} />}
      <OverlayCanvas
        className="overlay-layer"
        style={{ position: 'absolute', inset: 0 }}
        label={label}
        draw={(ctx, w, h) => drawMiniMap(ctx, w, h, model, frame, th, { insetBottom, margin: 28, view: mapView, friend, friends, north: false })}
      />
    </div>
  );
}
