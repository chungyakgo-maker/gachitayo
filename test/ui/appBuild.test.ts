import { afterEach, describe, expect, it, vi } from 'vitest';

// 아이폰 앱 디고 (사양서 13.3): 같은 코드를 웹과 앱 두 가지로 빌드한다

describe('앱 빌드 모드 (사양서 13.3)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../src/platform');
    vi.doUnmock('virtual:pwa-register');
  });

  it('시험(웹)에서는 앱이 아니다', async () => {
    const { isApp } = await import('../../src/platform');
    expect(isApp()).toBe(false);
  });

  it('앱이면 서비스워커를 등록하지 않는다 (새 버전은 앱 업데이트로)', async () => {
    const registerSW = vi.fn();
    vi.doMock('virtual:pwa-register', () => ({ registerSW }));
    vi.doMock('../../src/platform', () => ({ isApp: () => true }));
    const { registerServiceWorker } = await import('../../src/ui/pwa/registration');
    registerServiceWorker();
    expect(registerSW).not.toHaveBeenCalled();
  });

  it('웹이면 지금처럼 서비스워커를 등록한다', async () => {
    const registerSW = vi.fn();
    vi.doMock('virtual:pwa-register', () => ({ registerSW }));
    const { registerServiceWorker } = await import('../../src/ui/pwa/registration');
    registerServiceWorker();
    expect(registerSW).toHaveBeenCalledTimes(1);
  });
});
