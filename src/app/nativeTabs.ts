// 아이폰 앱 아래 탭 유리 알약 (2026-11-20 세영 "하단 메뉴바 아이폰 SDK 유리 알약으로 … 버튼 크기에 맞춰서 알약 가로 길이를 정해",
// 시안 docs/mock/2026-11-20-native-tabs.jpg, 메리고 1.0.2 방식). 1.0.2 부터.
// · 앱(ios/App/App/NativeTabBar.swift)이 페이지를 그리기 전에 html 에 native-tabs 를 붙인다. 이 표시가 있을 때만 아래가 돈다
//   (웹·예전 앱은 사이트 탭 그대로)
// · 사이트 탭은 지우지 않고 투명하게 자리만 남긴다(styles.css .tabbed.native). 그 탭이 "지금 어느 탭인지, 알약이 보일 때인지"를
//   앱에 알린다(DgoTabBar.set) — 값이 바뀔 때와 3초마다(앱이 페이지를 새로 읽느라 숨긴 뒤 다시 켜지게)
// · 숨기는 때: 글자를 칠 때(키보드), 아래에서 올라온 창이 알약 자리를 덮을 때(아이폰 부품은 늘 화면 맨 위라 그 창을 가리게 되니까),
//   탭 화면을 떠날 때(주행·준비·상세 화면)
// · 알약을 누르면 앱이 dgo:native-tab 소식(탭 경로)을 보내고, 사이트 탭을 누른 것과 똑같이 그 화면으로 옮긴다
import { registerPlugin } from '@capacitor/core';
import { useEffect, type RefObject } from 'react';

export interface DgoTabBarPlugin {
  set(o: { tab: string; show: boolean }): Promise<void>;
}
export const DgoTabBar = registerPlugin<DgoTabBarPlugin>('DgoTabBar');

export const NATIVE_TAB_EVENT = 'dgo:native-tab';
/** 알약이 고를 수 있는 탭 (TabBar.tsx TABS 와 같은 순서, 앱 NativeTabBar.items 와 같은 경로) */
export const NATIVE_TAB_PATHS = ['/', '/courses', '/history', '/settings'] as const;
/** 사이트 탭 자리 위 끝에서 알약 한가운데까지: 위 8 + 알약 높이 62 의 반 (styles.css --native-tab-h 와 같은 셈) */
const PILL_CENTER_FROM_TOP = 8 + 31;
/** 탭 화면을 떠난 뒤 이만큼(ms) 기다렸다 숨긴다 — 탭 사이를 옮기면 다음 탭 화면이 그 사이에 다시 알려 숨김을 취소한다(깜빡임 없음) */
const HIDE_DELAY_MS = 120;
let pendingHide: ReturnType<typeof setTimeout> | null = null;

/** 앱이 유리 알약을 그리는 중인가 (html 표시) */
export const nativeTabsOn = (): boolean => typeof document !== 'undefined' && document.documentElement.classList.contains('native-tabs');

/** 키보드가 뜨는 입력 칸에 글자를 치는 중인가 (체크 칸·단추는 아니다) */
function typing(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  if (a.isContentEditable || a.tagName === 'TEXTAREA') return true;
  if (a.tagName !== 'INPUT') return false;
  const t = (a as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'].includes(t);
}

/** 지금 알약을 보여도 되나: 사이트 탭 자리가 있고, 글자를 치지 않고, 알약 한가운데 맨 위가 사이트 탭이다 */
function visibleNow(nav: HTMLElement | null): boolean {
  if (!nav || typing()) return false;
  const r = nav.getBoundingClientRect();
  if (r.width < 40 || r.height < 20) return false;
  const top = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(r.left + r.width / 2, r.top + PILL_CENTER_FROM_TOP) : null;
  return top !== null && nav.contains(top);
}

/** 탭 화면(Tabbed)이 부른다: 앱에 지금 탭·보일지를 알리고, 알약 누름을 받아 탭을 옮긴다. 앱이 아니면 아무것도 안 한다 */
export function useNativeTabs(path: string, nav: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!nativeTabsOn()) return;
    if (pendingHide) clearTimeout(pendingHide);
    pendingHide = null;
    let last = '';
    const send = (show: boolean) => void DgoTabBar.set({ tab: path, show }).catch(() => {});
    const report = (force = false) => {
      const show = visibleNow(nav.current);
      const key = String(show);
      if (!force && key === last) return;
      last = key;
      send(show);
    };
    report(true);
    const timer = setInterval(() => report(true), 3000);
    // 화면 조각이 바뀌면(창이 열리고 닫힘) 다시 본다
    const mo = new MutationObserver(() => report());
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    const onChange = () => report();
    // 칸에서 나가면 다음 칸으로 옮겨 가는 중일 수 있어 한 박자 뒤에 본다
    const onBlur = () => setTimeout(() => report(), 0);
    window.addEventListener('resize', onChange);
    document.addEventListener('focusin', onChange);
    document.addEventListener('focusout', onBlur);
    const onTap = (e: Event) => {
      const to = (e as CustomEvent<unknown>).detail;
      if (typeof to === 'string' && (NATIVE_TAB_PATHS as readonly string[]).includes(to) && `#${to}` !== location.hash) location.hash = `#${to}`;
    };
    window.addEventListener(NATIVE_TAB_EVENT, onTap);
    return () => {
      clearInterval(timer);
      mo.disconnect();
      window.removeEventListener('resize', onChange);
      document.removeEventListener('focusin', onChange);
      document.removeEventListener('focusout', onBlur);
      window.removeEventListener(NATIVE_TAB_EVENT, onTap);
      // 탭 화면을 떠난다(주행·준비·상세): 조금 뒤 숨김. 다른 탭 화면으로 옮긴 것이면 그 화면이 취소한다
      pendingHide = setTimeout(() => {
        pendingHide = null;
        send(false);
      }, HIDE_DELAY_MS);
    };
  }, [path, nav]);
}
