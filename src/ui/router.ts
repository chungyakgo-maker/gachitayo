// 해시 라우팅 (사양서 4장): GitHub Pages 하위 경로와 새로고침 404 문제를 피한다.
// 주소 예: https://chungyakgo-maker.github.io/gachitayo/#/courses
import { useSyncExternalStore } from 'react';

/** location.hash → 경로 ("#/courses?x=1" → "/courses", "" → "/") */
export function parseHashPath(hash: string): string {
  const raw = hash.replace(/^#/, '');
  const path = raw.split('?')[0] ?? '';
  return path.startsWith('/') ? path : `/${path}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** 현재 해시 경로. 해시가 바뀌면 다시 그린다. */
export function useHashPath(): string {
  return useSyncExternalStore(subscribe, () => parseHashPath(window.location.hash));
}
