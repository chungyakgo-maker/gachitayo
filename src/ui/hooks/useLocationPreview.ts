// 메인 화면에서 현재 위치 보기 (기록하지 않음): 코스 자동 감지와 GPS 오차 표시용.
// 위치 권한이 이미 허용됐을 때만 켠다 (허용 창은 "주행 시작"에서 띄운다).
// request면 아직 허용 전이어도 켠다 (목적지 고르기: 지금 위치가 있어야 경로를 받는다. 아이폰은 허용해도 "prompt"로 알려 주는 경우가 많다)
import { useEffect, useState } from 'react';
import { startGps } from '../../sensors/gps';
import { queryLocationPermission, type LocationPermission } from '../../sensors/permissions';

export interface PreviewFix {
  lat: number;
  lon: number;
  hAcc: number;
}

export function useLocationPreview(enabled: boolean, request = false): { fix: PreviewFix | null; permission: LocationPermission } {
  const [fix, setFix] = useState<PreviewFix | null>(null);
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  useEffect(() => {
    if (!enabled) return;
    let stop: (() => void) | null = null;
    let alive = true;
    void queryLocationPermission().then((p) => {
      if (!alive) return;
      setPermission(p);
      if (p !== 'granted' && !(request && p !== 'denied')) return;
      stop = startGps(
        { now: () => performance.now() },
        (s) => {
          setFix({ lat: s.lat, lon: s.lon, hAcc: s.hAcc });
          setPermission('granted');
        },
        (e) => {
          if (e === 'denied') setPermission('denied');
        },
      );
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [enabled, request]);
  return { fix, permission };
}
