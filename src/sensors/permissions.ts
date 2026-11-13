// 위치 권한 상태 확인. 허용 창은 위치를 처음 쓸 때(startGps) 브라우저가 띄운다.

import { isApp } from '../platform';

export type LocationPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export async function queryLocationPermission(): Promise<LocationPermission> {
  // 아이폰 앱(사양서 13.3): 웹뷰의 권한 값은 앱 권한과 달라 모름으로 둔다. 권한 창은 주행 시작 때 위치 플러그인이 띄운다
  if (isApp()) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}
