// 지도 길게 눌러 고르기 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.4): 550 ms, 10 px 넘게 움직이면 취소
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { attachLongPress } from '../../src/ui/map/longPress';

let el: HTMLElement;
let hits: Array<[number, number]>;
let detach: () => void;
const touch = (x: number, y: number) => ({ clientX: x, clientY: y });
beforeEach(() => {
  vi.useFakeTimers();
  el = document.createElement('div');
  document.body.appendChild(el);
  hits = [];
  detach = attachLongPress(el, (x, y) => hits.push([x, y]));
});
afterEach(() => {
  detach();
  el.remove();
  vi.useRealTimers();
});

describe('attachLongPress', () => {
  it('fires after 550 ms', () => {
    fireEvent.touchStart(el, { touches: [touch(100, 120)] });
    vi.advanceTimersByTime(549);
    expect(hits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(hits).toEqual([[100, 120]]);
  });

  it('small wobble still fires', () => {
    fireEvent.touchStart(el, { touches: [touch(100, 100)] });
    fireEvent.touchMove(el, { touches: [touch(106, 104)] });
    vi.advanceTimersByTime(600);
    expect(hits).toEqual([[100, 100]]);
  });

  it('move over 10 px cancels', () => {
    fireEvent.touchStart(el, { touches: [touch(100, 100)] });
    fireEvent.touchMove(el, { touches: [touch(100, 112)] });
    vi.advanceTimersByTime(600);
    expect(hits).toEqual([]);
  });

  it('second finger cancels', () => {
    fireEvent.touchStart(el, { touches: [touch(100, 100)] });
    fireEvent.touchStart(el, { touches: [touch(100, 100), touch(200, 200)] });
    vi.advanceTimersByTime(600);
    expect(hits).toEqual([]);
  });

  it('touchend before cancels', () => {
    fireEvent.touchStart(el, { touches: [touch(100, 100)] });
    vi.advanceTimersByTime(300);
    fireEvent.touchEnd(el, { touches: [] });
    vi.advanceTimersByTime(600);
    expect(hits).toEqual([]);
  });

  it('contextmenu fires once and is prevented', () => {
    const notPrevented = fireEvent.contextMenu(el, { clientX: 5, clientY: 6 });
    expect(notPrevented).toBe(false);
    expect(hits).toEqual([[5, 6]]);
  });

  it('contextmenu right after touch press is ignored', () => {
    fireEvent.touchStart(el, { touches: [touch(100, 100)] });
    vi.advanceTimersByTime(550);
    vi.advanceTimersByTime(100);
    fireEvent.contextMenu(el, { clientX: 100, clientY: 100 });
    expect(hits).toHaveLength(1);
    vi.advanceTimersByTime(900);
    fireEvent.contextMenu(el, { clientX: 7, clientY: 8 });
    expect(hits).toEqual([
      [100, 100],
      [7, 8],
    ]);
  });

  it('contextmenu during touch hold replaces the timer', () => {
    fireEvent.touchStart(el, { touches: [touch(100, 100)] });
    vi.advanceTimersByTime(400);
    fireEvent.contextMenu(el, { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(600);
    expect(hits).toEqual([[100, 100]]);
  });

  it('detach stops listening', () => {
    detach();
    fireEvent.contextMenu(el, { clientX: 5, clientY: 6 });
    expect(hits).toEqual([]);
  });
});
