// 앱 높이: 아이폰 홈 화면 앱(standalone, 상태 표시줄 black-translucent)에서 일부 iOS 버전은 100dvh와
// 화면 고정 요소의 높이를 상태 표시줄만큼 작게 잡아 아래 탭 밑에 빈 공간이 생긴다.
// 홈 화면 앱은 늘 화면 전체를 쓰므로 그때는 화면 크기로 앱 높이(--app-h)를 정한다. 그 밖(사파리 탭, 안드로이드)은 CSS 그대로.

export interface ViewportEnv {
  /** 아이폰·아이패드 홈 화면 앱이면 true (navigator.standalone, 아이폰 전용 값) */
  standalone: boolean | undefined;
  screenW: number;
  screenH: number;
  innerH: number;
  landscape: boolean;
}

/** 창이 화면보다 이만큼 넘게 작으면 키보드나 분할 화면으로 보고 창 높이를 쓴다 */
const SAFE_AREA_SLACK_PX = 200;

export function appHeightFor(e: ViewportEnv): number | null {
  if (e.standalone !== true) return null;
  // 아이폰의 screen 크기는 돌려도 세로 기준이다
  const full = e.landscape ? Math.min(e.screenW, e.screenH) : Math.max(e.screenW, e.screenH);
  if (!(full > 0)) return null;
  return full - e.innerH > SAFE_AREA_SLACK_PX ? e.innerH : full;
}

function currentEnv(): ViewportEnv {
  const landscape =
    typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: landscape)').matches : window.innerWidth > window.innerHeight;
  return {
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    screenW: screen.width,
    screenH: screen.height,
    innerH: window.innerHeight,
    landscape,
  };
}

/** 앱 시작 때 한 번. 화면 크기·방향이 바뀌면 다시 정한다. 멈추는 함수를 돌려준다 */
export function installAppHeight(): () => void {
  const root = document.documentElement;
  const apply = () => {
    const h = appHeightFor(currentEnv());
    if (h === null) root.style.removeProperty('--app-h');
    else root.style.setProperty('--app-h', `${Math.round(h)}px`);
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  return () => {
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
