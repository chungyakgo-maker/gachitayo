import { afterEach, describe, expect, it, vi } from 'vitest';
import { appHeightFor, installAppHeight } from '../../src/ui/viewport';

// 아이폰 16 Pro: 화면 393×852, 상태 표시줄 62
const iphone = { standalone: true, screenW: 393, screenH: 852, innerH: 852, landscape: false };

describe('앱 높이 (아이폰 홈 화면 앱에서 아래 탭이 중간에 뜨는 문제)', () => {
  it('홈 화면 앱이면 브라우저가 높이를 작게 잡아도 화면 전체 높이를 쓴다', () => {
    expect(appHeightFor(iphone)).toBe(852);
    expect(appHeightFor({ ...iphone, innerH: 790 })).toBe(852);
  });

  it('가로 화면은 짧은 변', () => {
    expect(appHeightFor({ ...iphone, landscape: true, innerH: 393 })).toBe(393);
  });

  it('브라우저(사파리 탭)·안드로이드는 손대지 않는다', () => {
    expect(appHeightFor({ ...iphone, standalone: false })).toBeNull();
    expect(appHeightFor({ ...iphone, standalone: undefined })).toBeNull();
  });

  it('창이 화면보다 훨씬 작으면(키보드, 아이패드 분할 화면) 창 높이를 쓴다', () => {
    expect(appHeightFor({ ...iphone, innerH: 500 })).toBe(500);
  });
});

describe('installAppHeight', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--app-h');
    vi.unstubAllGlobals();
  });

  it('홈 화면 앱이면 --app-h를 정하고, 화면이 바뀌면 다시 정한다', () => {
    vi.stubGlobal('navigator', { ...navigator, standalone: true });
    vi.stubGlobal('screen', { width: 393, height: 852 });
    vi.stubGlobal('innerHeight', 790);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('landscape') ? false : true }));
    const stop = installAppHeight();
    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('852px');
    // 화면 전체를 덮는 요소를 fixed 대신 absolute로 그리게 하는 표시 (styles.css html.app-h)
    expect(document.documentElement.classList.contains('app-h')).toBe(true);
    vi.stubGlobal('innerHeight', 400); // 키보드가 올라옴
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('400px');
    stop();
  });

  it('브라우저에서는 정하지 않는다 (CSS의 100dvh 그대로)', () => {
    vi.stubGlobal('navigator', { ...navigator, standalone: undefined });
    const stop = installAppHeight();
    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('');
    expect(document.documentElement.classList.contains('app-h')).toBe(false);
    stop();
  });
});
