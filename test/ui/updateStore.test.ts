import { describe, expect, it, vi } from 'vitest';
import { createUpdateStore } from '../../src/ui/pwa/updateStore';

function setup() {
  const applyUpdate = vi.fn();
  const reload = vi.fn();
  const store = createUpdateStore({ applyUpdate, reload });
  return { store, applyUpdate, reload };
}

describe('createUpdateStore', () => {
  it('처음에는 새 버전 없음', () => {
    const { store } = setup();
    expect(store.getNeedRefresh()).toBe(false);
  });

  it('새 버전을 알리면 상태가 바뀌고 구독자에게 알린다', () => {
    const { store } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    store.markNeedRefresh();
    expect(store.getNeedRefresh()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('이 창이 업데이트를 요청하지 않았으면, 새 버전이 제어를 넘겨받아도 새로고침하지 않는다 (주행 중 보호)', () => {
    const { store, reload } = setup();
    store.markNeedRefresh();
    store.onControllerTookOver();
    expect(reload).not.toHaveBeenCalled();
  });

  it('업데이트를 누르면 적용을 요청하고, 제어가 넘어오면 그때 새로고침한다', () => {
    const { store, applyUpdate, reload } = setup();
    store.markNeedRefresh();
    store.requestUpdate();
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    store.onControllerTookOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('다른 창에서 이미 새 버전이 적용됐으면, 업데이트를 누를 때 바로 새로고침한다', () => {
    const { store, applyUpdate, reload } = setup();
    store.markNeedRefresh();
    store.onControllerTookOver();
    store.requestUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(applyUpdate).not.toHaveBeenCalled();
  });
});
