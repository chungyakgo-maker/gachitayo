// 아이폰 앱 아래 탭 유리 알약 (2026-11-20 세영 시안 docs/mock/2026-11-20-native-tabs.jpg, 메리고 방식):
// 앱이 html 에 native-tabs 를 붙이면 사이트 탭은 투명하게 자리만 남기고, 지금 탭·보일지를 앱(DgoTabBar.set)에 알린다.
// 알약을 누르면 앱이 dgo:native-tab 소식을 보내고 사이트가 그 탭으로 옮긴다
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as Array<{ tab: string; show: boolean }>);
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ set: async (o: { tab: string; show: boolean }) => void sent.push(o) }) }));

import { Tabbed } from '../../src/ui/components/TabBar';

const html = document.documentElement;
let cover: Element | null = null;
const flush = () => act(async () => {});

beforeEach(() => {
  sent.length = 0;
  cover = null;
  location.hash = '#/courses';
  // jsdom 은 자리·겹침을 모른다: 사이트 탭은 화면 맨 아래 402 × 86, 그 한가운데에서 맨 위에 있는 것은 탭(덮개가 없으면)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tabbar') ? ({ top: 788, bottom: 874, left: 0, right: 402, width: 402, height: 86, x: 0, y: 788, toJSON: () => ({}) } as DOMRect) : ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  });
  document.elementFromPoint = vi.fn(() => cover ?? document.querySelector('.tabbar'));
});
afterEach(() => {
  cleanup();
  html.classList.remove('native-tabs');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('웹(브라우저)·예전 앱: 사이트 탭 그대로', () => {
  it('html 에 native-tabs 표시가 없으면 탭이 보이고 앱에 알리지 않는다', async () => {
    const r = render(<Tabbed path="/courses">본문</Tabbed>);
    await flush();
    const nav = r.container.querySelector('.tabbar')!;
    expect(nav.hasAttribute('data-native-on')).toBe(false);
    expect(r.container.querySelector('.tabbed')!.classList.contains('native')).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('아이폰 앱 1.0.2~: 유리 알약', () => {
  beforeEach(() => html.classList.add('native-tabs'));

  it('사이트 탭은 투명 자리(data-native-on)로 남고, 지금 탭과 "보임"을 알린다', async () => {
    const r = render(<Tabbed path="/courses">본문</Tabbed>);
    await flush();
    expect(r.container.querySelector('.tabbar')!.hasAttribute('data-native-on')).toBe(true);
    expect(r.container.querySelector('.tabbed')!.classList.contains('native')).toBe(true);
    expect(sent.at(-1)).toEqual({ tab: '/courses', show: true });
    // 알약 한가운데(탭 자리 위에서 8 + 31)를 본다
    expect(document.elementFromPoint).toHaveBeenCalledWith(201, 788 + 39);
  });

  it('아래에서 올라온 창이 알약 자리를 덮으면 숨긴다 (아이폰 부품은 늘 맨 위라 그 창을 가리게 되니까)', async () => {
    render(<Tabbed path="/">본문</Tabbed>);
    await flush();
    expect(sent.at(-1)!.show).toBe(true);
    const sheet = document.createElement('div');
    document.body.appendChild(sheet);
    cover = sheet;
    await act(async () => {
      sheet.textContent = '코스 창';
    });
    await flush();
    expect(sent.at(-1)).toEqual({ tab: '/', show: false });
    sheet.remove();
    cover = null;
    await flush();
    expect(sent.at(-1)).toEqual({ tab: '/', show: true });
  });

  it('글자를 칠 때(키보드)는 숨기고, 체크 칸을 누를 때는 그대로', async () => {
    const r = render(
      <Tabbed path="/settings">
        <input aria-label="닉네임" />
        <input type="checkbox" aria-label="동의" />
      </Tabbed>,
    );
    await flush();
    const [text, box] = [...r.container.querySelectorAll('input')];
    await act(async () => box!.focus());
    await flush();
    expect(sent.at(-1)!.show).toBe(true);
    await act(async () => text!.focus());
    await flush();
    expect(sent.at(-1)).toEqual({ tab: '/settings', show: false });
    await act(async () => text!.blur());
    await act(async () => new Promise((res) => setTimeout(res, 10)));
    expect(sent.at(-1)).toEqual({ tab: '/settings', show: true });
  });

  it('알약을 누르면(dgo:native-tab) 그 탭으로 옮긴다. 모르는 값은 무시', async () => {
    render(<Tabbed path="/courses">본문</Tabbed>);
    await flush();
    act(() => void window.dispatchEvent(new CustomEvent('dgo:native-tab', { detail: '/history' })));
    expect(location.hash).toBe('#/history');
    act(() => void window.dispatchEvent(new CustomEvent('dgo:native-tab', { detail: 'javascript:alert(1)' })));
    expect(location.hash).toBe('#/history');
  });

  it('3초마다 다시 알리고(앱이 숨긴 뒤 다시 켜지게), 탭 화면을 떠나면 숨김을 알린다', async () => {
    vi.useFakeTimers();
    const r = render(<Tabbed path="/history">본문</Tabbed>);
    await act(async () => {});
    const n = sent.length;
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(sent.length).toBe(n + 1);
    expect(sent.at(-1)).toEqual({ tab: '/history', show: true });
    r.unmount();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(sent.at(-1)).toEqual({ tab: '/history', show: false });
  });

  it('탭 사이를 옮길 때는 숨겼다 다시 켜지 않는다 (알약이 깜빡이지 않게)', async () => {
    const a = render(<Tabbed path="/courses">본문</Tabbed>);
    await flush();
    sent.length = 0;
    a.unmount();
    render(<Tabbed path="/history">본문</Tabbed>);
    await act(async () => new Promise((res) => setTimeout(res, 250)));
    expect(sent.some((x) => !x.show)).toBe(false);
    expect(sent.at(-1)).toEqual({ tab: '/history', show: true });
  });

  it('메인처럼 탭 높이를 재는 화면(tabbarRef)도 같은 탭을 가리킨다', async () => {
    const ref = { current: null as HTMLElement | null };
    const r = render(
      <Tabbed path="/" overlay tabbarRef={ref}>
        지도
      </Tabbed>,
    );
    await flush();
    expect(ref.current).toBe(r.container.querySelector('.tabbar'));
    expect(sent.at(-1)).toEqual({ tab: '/', show: true });
  });
});
