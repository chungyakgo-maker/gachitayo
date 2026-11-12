// 메인 화면에서 현재 위치 보기 (기록하지 않음): 코스 자동 감지와 GPS 오차 표시용.
// 위치 권한이 이미 허용됐을 때만 켠다 (허용 창은 "주행 시작"에서 띄운다).
import { useEffect, useState } from 'react';
import { startGps } from '../../sensors/gps';
import { queryLocationPermission, type LocationPermission } from '../../sensors/permissions';

export interface PreviewFix {
  lat: number;
  lon: number;
  hAcc: number;
}

export function useLocationPreview(enabled: boolean): { fix: PreviewFix | null; permission: LocationPermission } {
  const [fix, setFix] = useState<PreviewFix | null>(null);
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  useEffect(() => {
    if (!enabled) return;
    let stop: (() => void) | null = null;
    let alive = true;
    void queryLocationPermission().then((p) => {
      if (!alive) return;
      setPermission(p);
      if (p !== 'granted') return;
      stop = startGps(
        { now: () => performance.now() },
        (s) => setFix({ lat: s.lat, lon: s.lon, hAcc: s.hAcc }),
        (e) => {
          if (e === 'denied') setPermission('denied');
        },
      );
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [enabled]);
  return { fix, permission };
}
