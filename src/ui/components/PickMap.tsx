// 코스 편집 지도 (사양서 8.7): 모양(선·점·글자)을 그리고, 지도를 누르면 그 위경도를 알려 준다.
// 선 지도(사양서 8.9, 우리 색 OSM 벡터)를 쓸 수 있으면 그것으로, 아니면 예전 사진 지도로 그린다.
import { useEffect, useRef, useState } from 'react';
import type { MapShape, PickMapController } from '../map/courseStyle';
import { lineMapConfig } from '../map/lineMapSupport';

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export function PickMap({ shapes, fit, fitKey, onPick, label, className = 'course-map' }: { shapes: MapShape[]; fit?: Array<[number, number]>; fitKey: string; onPick: (lat: number, lon: number) => void; label: string; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const ctl = useRef<PickMapController | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [ready, setReady] = useState(false);
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const onPick = (lat: number, lon: number) => pick.current(lat, lon);
    void (async () => {
      const cfg = await lineMapConfig();
      if (!alive || !el.current) return;
      if (cfg) {
        try {
          const { createLinePickMap } = await import('../map/lineMap');
          if (!alive || !el.current) return;
          ctl.current = createLinePickMap(el.current, onPick, cfg);
          setReady(true);
          return;
        } catch {
          // 선 지도를 못 띄우면 사진 지도로
        }
      }
      const { createPickMap } = await import('../map/leafletMap');
      if (!alive || !el.current) return;
      ctl.current = createPickMap(el.current, onPick);
      ctl.current.setOnline(isOnline());
      setReady(true);
    })().catch(() => {});
    return () => {
      alive = false;
      ctl.current?.destroy();
      ctl.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const doFit = fitted.current !== fitKey;
    ctl.current?.setShapes(shapes, doFit ? fit : undefined);
    if (doFit && fit && fit.length) fitted.current = fitKey;
  }, [ready, shapes, fit, fitKey]);

  return (
    <div className={className} role="region" aria-label={label}>
      <div ref={el} className="leaflet-host" />
    </div>
  );
}
