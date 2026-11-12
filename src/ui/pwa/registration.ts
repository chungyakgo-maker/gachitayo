// 서비스 워커 등록. 앱 시작 때 main.tsx에서 한 번만 부른다.
// (화면 컴포넌트 안에서 등록하면 화면이 바뀔 때마다 다시 등록되고 리스너가 쌓인다.)
import { registerSW } from 'virtual:pwa-register';
import { createUpdateStore } from './updateStore';

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

export const updateStore = createUpdateStore({
  applyUpdate: () => void updateSW?.(true),
  reload: () => window.location.reload(),
});

export function registerServiceWorker(): void {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => updateStore.markNeedRefresh(),
    // 라이브러리가 스스로 새로고침하지 않게 하고, 이 창이 요청했을 때만 새로고침한다.
    onNeedReload: () => updateStore.onControllerTookOver(),
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // 홈 화면 앱은 다시 열려도 새로 불러오지 않으므로, 다시 보일 때 새 버전을 확인한다.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        registration.update().catch(() => {
          // 통신이 없으면 실패한다. 다음에 다시 보일 때 또 확인한다.
        });
      });
    },
  });
}
