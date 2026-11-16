// 위치 수신 (사양서 5.1): watchPosition, enableHighAccuracy, maximumAge 0
import { toGpsSample } from '../normalize/sensorSamples';
import type { SessionClock } from '../normalize/sessionClock';
import type { GpsSample } from '../types/samples';

export type GpsErrorKind = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

/** 위치 수신을 시작하고, 멈추는 함수를 돌려준다. 처음 호출할 때 브라우저가 허용 창을 띄운다. */
export function startGps(
  clock: SessionClock,
  onSample: (s: GpsSample) => void,
  onError: (e: GpsErrorKind) => void,
): () => void {
  if (!('geolocation' in navigator)) {
    onError('unsupported');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => onSample(toGpsSample(pos, clock.now())),
    (err) =>
      onError(
        err.code === err.PERMISSION_DENIED
          ? 'denied'
          : err.code === err.TIMEOUT
            ? 'timeout'
            : 'unavailable',
      ),
    { enableHighAccuracy: true, maximumAge: 0 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
