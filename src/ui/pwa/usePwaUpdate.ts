import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * 서비스 워커 등록과 새 버전 확인.
 * 새 버전은 needRefresh로 알리기만 하고, update()를 불러야 적용된다(주행 중 자동 새로고침 방지).
 */
export function usePwaUpdate(): { needRefresh: boolean; update: () => void } {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // 홈 화면 앱은 백그라운드에서 다시 열려도 새로 불러오지 않으므로, 다시 보일 때 새 버전을 확인한다.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
  });
  return { needRefresh, update: () => void updateServiceWorker(true) };
}
