import { useCallback, useRef, type ReactNode, type RefObject } from 'react';
import { nativeTabsOn, useNativeTabs } from '../../app/nativeTabs';
import { IconChart, IconCourse, IconPin, IconSettings } from '../icons';

const TABS = [
  { path: '/', label: '메인', Icon: IconPin },
  { path: '/courses', label: '코스', Icon: IconCourse },
  { path: '/history', label: '기록', Icon: IconChart },
  { path: '/settings', label: '설정', Icon: IconSettings },
];

/**
 * 아래 탭이 있는 화면 (사양서 8.2).
 * overlay: 본문이 화면 전체(메인 지도)이고 탭은 그 위에 반투명으로 얹는다 (사용자 요청). tabbarRef로 탭 높이를 잰다
 * 아이폰 앱 1.0.2~ (html.native-tabs): 탭은 아이폰 유리 알약이 그리고, 사이트 탭은 투명하게 자리만 남아 앱에 알린다 (app/nativeTabs.ts)
 */
export function Tabbed({ path, children, overlay = false, tabbarRef }: { path: string; children: ReactNode; overlay?: boolean; tabbarRef?: RefObject<HTMLElement | null> }) {
  const native = nativeTabsOn();
  const own = useRef<HTMLElement | null>(null);
  // 탭 높이를 재는 화면(메인)의 ref 와 알약 알림이 같은 탭을 본다
  const setNav = useCallback(
    (el: HTMLElement | null) => {
      own.current = el;
      if (tabbarRef) (tabbarRef as { current: HTMLElement | null }).current = el;
    },
    [tabbarRef],
  );
  useNativeTabs(path, own);
  return (
    <div className={`tabbed${overlay ? ' overlay' : ''}${native ? ' native' : ''}`}>
      <div className="tabbed-body">{children}</div>
      <nav className="tabbar" aria-label="주 메뉴" ref={setNav} data-native-on={native ? '' : undefined}>
        {TABS.map(({ path: p, label, Icon }) => (
          <a key={p} href={`#${p}`} aria-current={p === path ? 'page' : undefined}>
            <Icon size={22} />
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}
