// 화면 전체를 덮는 창(안내 창, 고르기 창)은 문서 맨 끝(body)에 붙인다.
// 아이폰 홈 화면 앱에서는 이 창들을 fixed 대신 문서 맨 위 기준 absolute로 그리므로(styles.css html.app-h),
// 어느 상자 안에 있든 화면 전체를 덮게 하려고.
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Overlay({ children }: { children: ReactNode }) {
  return typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body);
}
