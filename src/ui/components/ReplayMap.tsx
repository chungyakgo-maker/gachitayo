// 재생 모드의 지도 모드 지도 (사용자 요청): OpenStreetMap 지도 위에 코스·고스트·내 위치를 그린다.
// "전체 코스"(화면을 꽉 채우게)와 "따라가기"(내 차를 가깝게) 두 가지. 지도를 불러오지 못하면 타일 없는 미니맵으로 그린다.
import { useEffect, useRef, useState } from 'react';
import { fromLocal, type LatLon } from '../../engine/geo';
import type { ReplayMapController } from '../map/leafletMap';
import { drawMiniMap, type MapModel, type MapView, type MiniMapOpts } from '../overlay/minimap';
import type { OverlayFrame } from '../overlay/frame';
import type { OverlayTheme } from '../overlay/theme';
import { OverlayCanvas } from './OverlayCanvas';

export type ReplayView = 'fit' | 'follow';

export interface ReplayMapProps {
  model: MapModel;
  frame: OverlayFrame;
  origin: LatLon | null;
  th: OverlayTheme;
  insetBottom: number;
  label: string;
  friend?: MiniMapOpts['friend'];
}

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export function ReplayMap({ model, frame, origin, th, insetBottom, label, friend }: ReplayMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const ctl = useRef<ReplayMapController | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [view, setView] = useState<ReplayView>('fit');

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
  }, [state, model, origin?.lat, origin?.lon, view, insetBottom, model.line.length ? 0 : Math.floor(pathLen / 20)]);

  // 따라가기: 그릴 때마다 내 위치로
  if (state === 'ready' && view === 'follow' && frame.me && origin) {
    const ll = fromLocal(origin, frame.me.x, frame.me.y);
    ctl.current?.follow(ll.lat, ll.lon, insetBottom);
  }

  // 평면 좌표 → 지도 화면 좌표. 위도는 y에만, 경도는 x에만 달려 있어(fromLocal, 북쪽이 위) 축마다 따로 바꾼다
  const c = ctl.current;
  const mapView: MapView | undefined =
    state === 'ready' && origin && c
      ? {
          X: (x: number) => c.project(origin.lat, fromLocal(origin, x, 0).lon).x,
          Y: (y: number) => c.project(fromLocal(origin, 0, y).lat, origin.lon).y,
        }
      : undefined;

  return (
    <div className="replay-map">
      {state !== 'failed' && <div ref={el} className="leaflet-host" />}
      <OverlayCanvas
        className="overlay-layer"
        style={{ position: 'absolute', inset: 0 }}
        label={label}
        draw={(ctx, w, h) => drawMiniMap(ctx, w, h, model, frame, th, { insetBottom, margin: 28, view: mapView, friend })}
      />
      {state === 'ready' && (
        <div className="segmented small map-view-toggle" role="group" aria-label="재생 지도 보기">
          <button type="button" aria-pressed={view === 'fit'} onClick={() => setView('fit')}>
            전체 코스
          </button>
          <button type="button" aria-pressed={view === 'follow'} onClick={() => setView('follow')}>
            따라가기
          </button>
        </div>
      )}
    </div>
  );
}
