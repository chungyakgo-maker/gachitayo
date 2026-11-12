// 지도 위에 얹은 칸들이 지도를 위·아래에서 얼마나 가리는지 (px). 내 위치를 "가려지지 않은 지도"의 가운데에 두려고 (사용자 요청).
// 가로 화면처럼 칸이 지도 옆에 있으면(겹치지 않으면) 0이다.
import { useLayoutEffect, useState, type RefObject } from 'react';

export interface Insets {
  top: number;
  bottom: number;
}

export function useOverlayInsets(base: RefObject<HTMLElement | null>, top: RefObject<HTMLElement | null>, bottom: RefObject<HTMLElement | null>): Insets {
  const [ins, setIns] = useState<Insets>({ top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const b = base.current?.getBoundingClientRect();
      if (!b || b.height <= 0) return;
      const over = (r: DOMRect | undefined) => r !== undefined && r.width > 0 && r.right > b.left + 1 && r.left < b.right - 1;
      const tr = top.current?.getBoundingClientRect();
      const br = bottom.current?.getBoundingClientRect();
      const t = over(tr) ? Math.round(Math.min(b.height, Math.max(0, tr!.bottom - b.top))) : 0;
      const bt = over(br) ? Math.round(Math.min(b.height, Math.max(0, b.bottom - br!.top))) : 0;
      setIns((p) => (p.top === t && p.bottom === bt ? p : { top: t, bottom: bt }));
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const r of [base, top, bottom]) if (r.current) ro?.observe(r.current);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  });
  return ins;
}
