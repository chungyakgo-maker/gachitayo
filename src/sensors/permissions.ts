// 위치 권한 상태 확인. 허용 창은 위치를 처음 쓸 때(startGps) 브라우저가 띄운다.

export type LocationPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export async function queryLocationPermission(): Promise<LocationPermission> {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}
