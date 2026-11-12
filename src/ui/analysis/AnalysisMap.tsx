// 분석 지도 (사양서 8.6): OSM 지도 위에 랩 A(속도 색칠)와 랩 B(회색 점선), 고른 지점. 지도를 누르면 그 위치를 알려 준다.
import { useEffect, useRef, useState } from 'react';
import type { AnalysisLapLine, AnalysisMapController } from '../map/leafletMap';

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export function AnalysisMap({ a, b, marker, onPick, fitKey }: { a: AnalysisLapLine | null; b: AnalysisLapLine | null; marker: [number, number] | null; onPick: (lat: number, lon: number) => void; fitKey: string }) {
  const el = useRef<HTMLDivElement>(null);
  const ctl = useRef<AnalysisMapController | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [ready, setReady] = useState(false);
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    import('../map/leafletMap')
      .then(({ createAnalysisMap }) => {
        if (!alive || !el.current) return;
        ctl.current = createAnalysisMap(el.current, (lat, lon) => pick.current(lat, lon));
        ctl.current.setOnline(isOnline());
        setReady(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
      ctl.current?.destroy();
      ctl.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    ctl.current?.setLines(a, b, fitted.current !== fitKey);
    fitted.current = fitKey;
  }, [ready, a, b, fitKey]);

  useEffect(() => {
    if (ready) ctl.current?.setMarker(marker);
  }, [ready, marker]);

  return (
    <div className="analysis-map" role="region" aria-label="분석 지도: 랩 A 속도 색칠, 랩 B 점선">
      <div ref={el} className="leaflet-host" />
    </div>
  );
}
