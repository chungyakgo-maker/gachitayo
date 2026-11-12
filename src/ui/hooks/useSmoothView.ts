// 나를 가운데 / 진행 방향 위 보기에서 화면이 흔들리지 않게: 진행 방향과 보이는 거리를 부드럽게 바꾼다.
import { useRef } from 'react';

/** 각도(라디안)를 지수 평활. 한 바퀴 넘어가는 곳(±π)도 자연스럽게 */
export function useSmoothAngle(a: number | null | undefined, k = 0.3): number | null {
  const v = useRef<number | null>(null);
  if (a === null || a === undefined || !Number.isFinite(a)) return v.current;
  if (v.current === null) v.current = a;
  else {
    let d = a - v.current;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    v.current += d * k;
  }
  return v.current;
}
