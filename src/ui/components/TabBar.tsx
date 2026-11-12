import type { ReactNode, RefObject } from 'react';
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
 */
export function Tabbed({ path, children, overlay = false, tabbarRef }: { path: string; children: ReactNode; overlay?: boolean; tabbarRef?: RefObject<HTMLElement | null> }) {
  return (
    <div className={`tabbed${overlay ? ' overlay' : ''}`}>
      <div className="tabbed-body">{children}</div>
      <nav className="tabbar" aria-label="주 메뉴" ref={tabbarRef as RefObject<HTMLElement> | undefined}>
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
