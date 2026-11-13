// 아이폰 앱 디고의 주행 기록 위치 (사양서 13.3): 백그라운드 위치 플러그인. 화면이 꺼지거나 앱을 내려도 이어진다.
// 웹 위치(watchPosition)와 같은 GPS 표본으로 바꿔 넘긴다. 권한 창은 플러그인이 띄운다("항상 허용" 안내는 Info.plist 문구).
import { registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, Location } from '@capacitor-community/background-geolocation';
import { toGpsSample } from '../normalize/sensorSamples';
import type { SessionClock } from '../normalize/sessionClock';
import type { GpsSample } from '../types/samples';
import type { GpsErrorKind } from './gps';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

function toSample(p: Location, tRecv: number): GpsSample {
  return toGpsSample(
    {
      coords: { latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, altitude: p.altitude, altitudeAccuracy: p.altitudeAccuracy, speed: p.speed, heading: p.bearing },
      timestamp: p.time ?? Date.now(),
    },
    tRecv,
  );
}

/** 백그라운드 위치를 받기 시작하고, 멈추는 함수를 돌려준다. 시작 응답보다 멈춤이 먼저 와도 응답이 오면 끈다 */
export function startNativeGps(clock: SessionClock, onSample: (s: GpsSample) => void, onError: (e: GpsErrorKind) => void): () => void {
  let stopped = false;
  let id: string | null = null;
  const remove = () => {
    if (id !== null) void BackgroundGeolocation.removeWatcher({ id });
    id = null;
  };
  void BackgroundGeolocation.addWatcher(
    { backgroundTitle: '디고 주행 기록 중', backgroundMessage: '화면이 꺼져도 위치를 기록해요', requestPermissions: true, stale: false, distanceFilter: 0 },
    (position, error) => {
      if (stopped) return;
      if (error) onError(error.code === 'NOT_AUTHORIZED' ? 'denied' : 'unavailable');
      else if (position) onSample(toSample(position, clock.now()));
    },
  ).then(
    (w) => {
      id = w;
      if (stopped) remove();
    },
    () => {
      if (!stopped) onError('unavailable');
    },
  );
  return () => {
    stopped = true;
    remove();
  };
}
