// 새 버전 적용 상태. 서비스 워커와 분리한 순수 로직이라 테스트할 수 있다.
//
// 규칙: 이 창에서 사용자가 '업데이트'를 누른 경우에만 새로고침한다.
// 같은 앱을 연 다른 창(예: 안드로이드 크롬 탭)에서 업데이트를 적용해도,
// 주행 중인 이 창은 새로고침되지 않는다.

export interface UpdateStore {
  subscribe(listener: () => void): () => void;
  getNeedRefresh(): boolean;
  /** 새 버전이 설치되어 기다리는 중 */
  markNeedRefresh(): void;
  /** 사용자가 '업데이트'를 눌렀다 */
  requestUpdate(): void;
  /** 새 버전 서비스 워커가 이 창의 제어를 넘겨받았다 */
  onControllerTookOver(): void;
}

export function createUpdateStore(deps: {
  applyUpdate: () => void;
  reload: () => void;
}): UpdateStore {
  let needRefresh = false;
  let requested = false;
  let tookOver = false;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getNeedRefresh: () => needRefresh,
    markNeedRefresh() {
      needRefresh = true;
      listeners.forEach((l) => l());
    },
    requestUpdate() {
      if (tookOver) {
        // 다른 창에서 이미 적용됨: 기다릴 것 없이 새 코드로 다시 연다.
        deps.reload();
        return;
      }
      requested = true;
      deps.applyUpdate();
    },
    onControllerTookOver() {
      tookOver = true;
      if (requested) deps.reload();
    },
  };
}
