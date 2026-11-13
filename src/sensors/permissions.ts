// 위치 권한 상태 확인. 허용 창은 위치를 처음 쓸 때(startGps) 브라우저가 띄운다.

import { isApp } from '../platform';
import { nativeLocationGranted } from './nativeGps';

export type LocationPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export async function queryLocationPermission(): Promise<LocationPermission> {
  // 아이폰 앱(사양서 13.3): 웹뷰의 권한 값은 앱 권한과 다르다. 위치를 한 번 받았으면 허용(메인 화면 미리보기가 켜진다),
  // 아니면 모름. 권한 창은 주행 시작 때 위치 플러그인이 띄운다
  if (isApp()) return nativeLocationGranted() ? 'granted' : 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}
