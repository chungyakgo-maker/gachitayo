// 아이콘 (디자인 시안의 선 아이콘)
import type { ReactNode, SVGProps } from 'react';

type IconProps = { size?: number; color?: string; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'color'>;

function make(children: ReactNode, defaults: { strokeWidth?: number } = {}) {
  return function Icon({ size = 22, color = 'currentColor', strokeWidth, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth ?? defaults.strokeWidth ?? 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {children}
      </svg>
    );
  };
}

export const IconBack = make(<path d="M15 5l-7 7 7 7" />);
export const IconChevron = make(<path d="M9 5l7 7-7 7" />);
export const IconArrowRight = make(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconSettings = make(
  <>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </>,
  { strokeWidth: 1.8 },
);
export const IconPin = make(
  <>
    <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z" />
    <circle cx="12" cy="10" r="2" />
  </>,
);
export const IconCourse = make(
  <>
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="6" r="2" />
    <path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" />
  </>,
  { strokeWidth: 1.8 },
);
export const IconChart = make(
  <>
    <path d="M4 20h16" />
    <path d="M6 16l4-5 3 3 5-7" />
  </>,
  { strokeWidth: 1.8 },
);
export const IconGps = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </>,
);
export const IconCheck = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.5 2.5L16 9.5" />
  </>,
);
export const IconPhone = make(
  <>
    <rect x="8" y="3" width="8" height="18" rx="2" />
    <path d="M4 9v6M20 9v6" />
  </>,
);
/** 내 위치로 (지도) */
export const IconLocate = make(<path d="M3 11l18-8-8 18-2-8-8-2z" />);
/** 지우기 (휴지통) */
export const IconTrash = make(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
export const IconStop = make(<rect x="6" y="6" width="12" height="12" rx="2" />);
export const IconCloud = make(
  <>
    <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.5a4 4 0 0 1 .5 7.97" />
    <path d="M12 12v8M9 15l3-3 3 3" />
  </>,
  { strokeWidth: 1.8 },
);
export const IconSave = make(
  <>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M8 4v5h8V4M8 20v-6h8v6" />
  </>,
  { strokeWidth: 1.8 },
);
export const IconWarn = make(
  <>
    <path d="M12 3l9.5 17H2.5z" />
    <path d="M12 10v4M12 17.5v.01" />
  </>,
);
