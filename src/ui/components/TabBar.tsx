import type { ReactNode } from 'react';
import { IconChart, IconCourse, IconPin, IconSettings } from '../icons';

const TABS = [
  { path: '/', label: '메인', Icon: IconPin },
  { path: '/courses', label: '코스', Icon: IconCourse },
  { path: '/history', label: '기록', Icon: IconChart },
  { path: '/settings', label: '설정', Icon: IconSettings },
];

/** 아래 탭이 있는 화면 (사양서 8.2) */
export function Tabbed({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div className="tabbed">
      <div className="tabbed-body">{children}</div>
      <nav className="tabbar" aria-label="주 메뉴">
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
