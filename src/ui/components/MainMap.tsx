// 메인 지도 (사양서 8.2): 통신이 되면 OpenStreetMap 타일 위에, 안 되면 타일 없이 격자 위에 그린다.
// Leaflet은 메인 화면이 처음 열릴 때 따로 불러온다 (앱 첫 화면을 빨리 띄우려고. 서비스 워커가 함께 보관해 통신 없이도 열린다).
// 불러오지 못하면 예전의 타일 없는 지도(CourseMap)로 그린다.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { toLocal } from '../../engine/geo';
import type { Course } from '../../types/course';
import type { FriendMarker, MainMapController, MapFix } from '../map/leafletMap';
import { IconLocate } from '../icons';
import { GpsIcon, type GpsState } from './GpsIcon';
import { CourseMap } from './CourseMap';

export interface MainMapProps {
  course: Course | null;
  me: MapFix | null;
  label: string;
  /** 위치 공유 중인 친구 */
  friends?: FriendMarker[];
  /** 위에 얹은 카드·아래 탭이 가리는 높이 (px). 내 위치는 가려지지 않은 영역 가운데 (사용자 요청) */
  insetTop?: number;
  insetBottom?: number;
  /** 오른쪽 위 GPS 아이콘 색 (사용자 요청) */
  gps?: GpsState;
  gpsAcc?: number | null;
  children?: ReactNode;
}

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

const insetVars = (t: number, b: number) => ({ '--inset-t': `${t}px`, '--inset-b': `${b}px` }) as CSSProperties;

export function MainMap({ course, me, label, friends = [], insetTop = 0, insetBottom = 0, gps, gpsAcc, children }: MainMapProps) {
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
    if (state === 'ready') ctl.current?.setInsets(insetTop, insetBottom);
  }, [state, insetTop, insetBottom]);
  useEffect(() => {
    if (state === 'ready') ctl.current?.update(course, me);
  }, [state, course, me]);
  useEffect(() => {
    if (state === 'ready') ctl.current?.setFriends(friends);
  }, [state, friends]);

  if (state === 'failed') {
    const local = me ? toLocal(course?.origin ?? { lat: me.lat, lon: me.lon }, me.lat, me.lon) : null;
    return (
      <div className="main-map" style={insetVars(insetTop, insetBottom)}>
        <CourseMap variant="main" course={course} me={local} label={label} insetTop={insetTop} insetBottom={insetBottom} />
        {gps && <GpsIcon className="gps-icon map-gps main" state={gps} hAcc={gpsAcc} />}
        {children}
      </div>
    );
  }
  return (
    <div className={`main-map${tiles ? ' has-tiles' : ''}`} style={insetVars(insetTop, insetBottom)}>
      <div ref={el} className="leaflet-host" role="region" aria-label={`${label}${tiles ? ' (지도: OpenStreetMap)' : ' (지도 그림 없음)'}`} />
      {state === 'ready' && (
        <button type="button" className="map-locate" aria-label="내 위치" disabled={!me} onClick={() => me && ctl.current?.locate(me)}>
          <IconLocate size={18} />
        </button>
      )}
      {state === 'ready' && friends.length > 0 && (
        <button type="button" className="map-friends" onClick={() => ctl.current?.fitFriends(me)}>
          위치 공유 중인 친구 {friends.length}명
        </button>
      )}
      {gps && <GpsIcon className="gps-icon map-gps main" state={gps} hAcc={gpsAcc} />}
      {children}
    </div>
  );
}
