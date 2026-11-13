// 화면 꺼짐 방지 (사양서 8.4): 켜고, 화면이 다시 보이면 다시 요청한다.
// 화면이 가려지면 시스템이 자동으로 해제하기 때문이다.
import { KeepAwake } from '@capacitor-community/keep-awake';
import { isApp } from '../platform';

export type WakeLockState = 'off' | 'active' | 'unsupported' | 'failed';

export interface SentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}

export interface WakeLockApiLike {
  request(type: 'screen'): Promise<SentinelLike>;
}

export interface VisibilityLike {
  isVisible(): boolean;
  onChange(cb: () => void): () => void;
}

export interface WakeLockManager {
  acquire(): Promise<WakeLockState>;
  release(): Promise<void>;
  getState(): WakeLockState;
  subscribe(cb: () => void): () => void;
}

export function createWakeLockManager(
  api: WakeLockApiLike | undefined,
  visibility: VisibilityLike,
): WakeLockManager {
  let state: WakeLockState = 'off';
  let wanted = false;
  let sentinel: SentinelLike | undefined;
  const listeners = new Set<() => void>();

  const setState = (s: WakeLockState) => {
    state = s;
    listeners.forEach((l) => l());
  };

  async function request(): Promise<WakeLockState> {
    if (!api) {
      setState('unsupported');
      return state;
    }
    try {
      const s = await api.request('screen');
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) {
          sentinel = undefined;
          setState('off');
        }
      });
      // 요청이 끝나기 전에 release()가 불렸으면 바로 놓는다
      if (!wanted) {
        await s.release();
        return state;
      }
      setState('active');
    } catch {
      setState('failed');
    }
    return state;
  }

  visibility.onChange(() => {
    // 해제 알림이 늦게 올 수 있으므로 상태 대신 잠금 자체가 살아 있는지 본다
    if (wanted && visibility.isVisible() && (!sentinel || sentinel.released)) void request();
  });

  return {
    acquire() {
      wanted = true;
      return request();
    },
    async release() {
      wanted = false;
      const s = sentinel;
      sentinel = undefined;
      setState('off');
      if (s && !s.released) await s.release();
    },
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** 아이폰 앱(사양서 13.3)의 화면 꺼짐 방지: keep-awake 플러그인을 Wake Lock 모양으로 감싼다 */
export function nativeWakeLockApi(): WakeLockApiLike {
  return {
    async request() {
      await KeepAwake.keepAwake();
      const listeners: Array<() => void> = [];
      const sentinel: SentinelLike = {
        released: false,
        async release() {
          if (sentinel.released) return;
          sentinel.released = true;
          await KeepAwake.allowSleep();
          listeners.forEach((l) => l());
        },
        addEventListener(_type, cb) {
          listeners.push(cb);
        },
      };
      return sentinel;
    },
  };
}

/** 브라우저의 Wake Lock API와 화면 표시 상태로 만든다. 아이폰 앱이면 keep-awake 플러그인. */
export function createBrowserWakeLockManager(): WakeLockManager {
  const api = isApp()
    ? nativeWakeLockApi()
    : 'wakeLock' in navigator && navigator.wakeLock
      ? (navigator.wakeLock as unknown as WakeLockApiLike)
      : undefined;
  return createWakeLockManager(api, {
    isVisible: () => document.visibilityState === 'visible',
    onChange(cb) {
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
  });
}
