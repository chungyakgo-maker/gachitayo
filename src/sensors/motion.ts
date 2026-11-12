// 모션 수신 (사양서 5.1, 6.3)
import { toRawMotionSample } from '../normalize/sensorSamples';
import type { SessionClock } from '../normalize/sessionClock';
import type { RawMotionSample } from '../types/samples';

export type MotionPermission = 'granted' | 'denied' | 'not-needed' | 'unsupported';

type RequestPermission = () => Promise<'granted' | 'denied'>;

/**
 * 모션 권한 요청. 아이폰은 버튼 탭 처리 안에서, 다른 await보다 먼저 불러야 허용 창이 뜬다.
 * 안드로이드는 권한 요청이 필요 없다.
 */
export function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof DeviceMotionEvent === 'undefined') return Promise.resolve('unsupported');
  const req = (DeviceMotionEvent as unknown as { requestPermission?: RequestPermission })
    .requestPermission;
  if (typeof req !== 'function') return Promise.resolve('not-needed');
  return req.call(DeviceMotionEvent).then(
    (r): MotionPermission => (r === 'granted' ? 'granted' : 'denied'),
    (): MotionPermission => 'denied',
  );
}

/** 모션 수신을 시작하고, 멈추는 함수를 돌려준다. */
export function startMotion(
  clock: SessionClock,
  onSample: (s: RawMotionSample) => void,
): () => void {
  const handler = (e: DeviceMotionEvent) => {
    const s = toRawMotionSample(e, clock.now());
    if (s) onSample(s);
  };
  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}
