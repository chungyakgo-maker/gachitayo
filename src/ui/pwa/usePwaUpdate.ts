import { useSyncExternalStore } from 'react';
import { updateStore } from './registration';

/** 새 버전이 있는지와 적용 함수. 적용은 사용자가 누를 때만 한다. */
export function usePwaUpdate(): { needRefresh: boolean; update: () => void } {
  const needRefresh = useSyncExternalStore(updateStore.subscribe, updateStore.getNeedRefresh);
  return { needRefresh, update: updateStore.requestUpdate };
}
