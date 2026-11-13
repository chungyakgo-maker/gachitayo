// 위치 수신 (사양서 5.1): watchPosition, enableHighAccuracy, maximumAge 0
import { toGpsSample } from '../normalize/sensorSamples';
import type { SessionClock } from '../normalize/sessionClock';
import type { GpsSample } from '../types/samples';
import { isApp } from '../platform';
import { startNativeGps } from './nativeGps';

export type GpsErrorKind = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

/** 위치 수신을 시작하고, 멈추는 함수를 돌려준다. 처음 호출할 때 브라우저가 허용 창을 띄운다.
 *  background: 주행 기록. 아이폰 앱(사양서 13.3)에서는 화면이 꺼져도 이어지는 백그라운드 위치를 쓴다.
 *  메인 화면 미리보기처럼 background가 아니면 앱에서도 앞에 있을 때만 받는다(앱을 내리면 꺼져 배터리를 아낀다). */
export function startGps(
  clock: SessionClock,
  onSample: (s: GpsSample) => void,
  onError: (e: GpsErrorKind) => void,
  opts: { background?: boolean } = {},
): () => void {
  if (opts.background && isApp()) return startNativeGps(clock, onSample, onError);
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
