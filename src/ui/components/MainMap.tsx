// 메인 지도 (사양서 8.2): 통신이 되면 OpenStreetMap 타일 위에, 안 되면 타일 없이 격자 위에 그린다.
// Leaflet은 메인 화면이 처음 열릴 때 따로 불러온다 (앱 첫 화면을 빨리 띄우려고. 서비스 워커가 함께 보관해 통신 없이도 열린다).
// 불러오지 못하면 예전의 타일 없는 지도(CourseMap)로 그린다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toLocal } from '../../engine/geo';
import type { Course } from '../../types/course';
import type { MainMapController, MapFix } from '../map/leafletMap';
import { IconLocate } from '../icons';
import { CourseMap } from './CourseMap';

export interface MainMapProps {
  course: Course | null;
  me: MapFix | null;
  label: string;
  children?: ReactNode;
}

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export function MainMap({ course, me, label, children }: MainMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const ctl = useRef<MainMapController | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [tiles, setTiles] = useState(false);

  useEffect(() => {
    let alive = true;
    import('../map/leafletMap')
      .then(({ createMainMap }) => {
        if (!alive || !el.current) return;
        ctl.current = createMainMap(el.current, setTiles);
        ctl.current.setOnline(isOnline());
        setState('ready');
      })
      .catch(() => alive && setState('failed'));
    const on = () => ctl.current?.setOnline(true);
    const off = () => ctl.current?.setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      alive = false;
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      ctl.current?.destroy();
      ctl.current = null;
    };
  }, []);

  useEffect(() => {
    if (state === 'ready') ctl.current?.update(course, me);
  }, [state, course, me]);

  if (state === 'failed') {
    const local = me ? toLocal(course?.origin ?? { lat: me.lat, lon: me.lon }, me.lat, me.lon) : null;
    return (
      <div className="main-map">
        <CourseMap variant="main" course={course} me={local} label={label} />
        {children}
      </div>
    );
  }
  return (
    <div className={`main-map${tiles ? ' has-tiles' : ''}`}>
      <div ref={el} className="leaflet-host" role="region" aria-label={`${label}${tiles ? ' (지도: OpenStreetMap)' : ' (지도 그림 없음)'}`} />
      {state === 'ready' && (
        <button type="button" className="map-locate" aria-label="내 위치" disabled={!me} onClick={() => me && ctl.current?.locate(me)}>
          <IconLocate size={18} />
        </button>
      )}
      {children}
    </div>
  );
}
