// 아이폰 앱 디고의 위치 (사양서 13.3): 위치 플러그인. 웹 위치(watchPosition)와 같은 GPS 표본으로 바꿔 넘긴다.
// - 주행 기록(background): 화면이 꺼지거나 앱을 내려도 이어지는 백그라운드 위치. 권한 창은 플러그인이 띄운다.
// - 메인 화면 미리보기(foreground): 앞에 떠 있을 때만, 권한 창 없이 (앱을 내리면 꺼져 배터리를 아낀다).
// 감시 번호는 폰에 적어 둔다: WebView가 다시 열리면(메모리 부족 등) JS는 감시를 잊지만 위치는 계속 켜져 있으므로,
// 앱 시작 때 적어 둔 감시를 끈다 (cleanupNativeGps).
import { registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, Location, WatcherOptions } from '@capacitor-community/background-geolocation';
import { toGpsSample } from '../normalize/sensorSamples';
import type { SessionClock } from '../normalize/sessionClock';
import type { GpsSample } from '../types/samples';
import type { GpsErrorKind } from './gps';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

const WATCHERS_KEY = 'gachitayo.nativeGpsWatchers';
const GRANTED_KEY = 'gachitayo.locationGranted';

function readIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(WATCHERS_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeIds(ids: string[]): void {
  try {
    if (ids.length) localStorage.setItem(WATCHERS_KEY, JSON.stringify(ids));
    else localStorage.removeItem(WATCHERS_KEY);
  } catch {
    // 저장할 수 없으면 이번 실행 동안만
  }
}
function setGranted(on: boolean): void {
  try {
    if (on) localStorage.setItem(GRANTED_KEY, '1');
    else localStorage.removeItem(GRANTED_KEY);
  } catch {
    // 저장할 수 없으면 미리보기가 켜지지 않을 뿐
  }
}

/** 앱에서 위치를 한 번이라도 받았는가 (권한 허용). 메인 화면 미리보기를 켜는 기준 */
export function nativeLocationGranted(): boolean {
  try {
    return localStorage.getItem(GRANTED_KEY) === '1';
  } catch {
    return false;
  }
}

const BACKGROUND: WatcherOptions = { backgroundTitle: '디고 주행 기록 중', backgroundMessage: '화면이 꺼져도 위치를 기록해요', requestPermissions: true, stale: false, distanceFilter: 0 };
const FOREGROUND: WatcherOptions = { requestPermissions: false, stale: false, distanceFilter: 0 };

function toSample(p: Location, tRecv: number): GpsSample {
  return toGpsSample(
    {
      coords: { latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, altitude: p.altitude, altitudeAccuracy: p.altitudeAccuracy, speed: p.speed, heading: p.bearing },
      timestamp: p.time ?? Date.now(),
    },
    tRecv,
  );
}

/** 위치를 받기 시작하고, 멈추는 함수를 돌려준다. 시작 응답보다 멈춤이 먼저 와도 응답이 오면 끈다 */
export function startNativeGps(clock: SessionClock, onSample: (s: GpsSample) => void, onError: (e: GpsErrorKind) => void, opts: { background?: boolean } = { background: true }): () => void {
  let stopped = false;
  let id: string | null = null;
  const remove = () => {
    if (id === null) return;
    const w = id;
    id = null;
    writeIds(readIds().filter((x) => x !== w));
    void BackgroundGeolocation.removeWatcher({ id: w });
  };
  void BackgroundGeolocation.addWatcher(opts.background ? BACKGROUND : FOREGROUND, (position, error) => {
    if (stopped) return;
    if (error) {
      if (error.code === 'NOT_AUTHORIZED') setGranted(false);
      onError(error.code === 'NOT_AUTHORIZED' ? 'denied' : 'unavailable');
    } else if (position) {
      setGranted(true);
      onSample(toSample(position, clock.now()));
    }
  }).then(
    (w) => {
      id = w;
      writeIds([...readIds(), w]);
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

/** 앱 시작 때: 지난번 페이지가 끄지 못하고 남긴 감시를 끈다 (이번 페이지의 감시를 만들기 전에 부른다) */
export async function cleanupNativeGps(): Promise<void> {
  const ids = readIds();
  writeIds([]);
  await Promise.all(ids.map((w) => BackgroundGeolocation.removeWatcher({ id: w }).catch(() => {})));
}
