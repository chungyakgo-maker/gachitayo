// 웹페이지 전체 확대·축소 막기 (사용자 요청 "웹페이지가 전체로 확대/축소 되는 느낌이야 이거 고정시켜")
import { afterEach, describe, expect, it } from 'vitest';
import { lockPageZoom } from '../../src/ui/viewport';

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

function touchMove(touches: number) {
  const e = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: Array.from({ length: touches }, () => ({ clientX: 0, clientY: 0 })) });
  document.body.dispatchEvent(e);
  return e;
}

describe('lockPageZoom', () => {
  it('stops Safari pinch gestures and two-finger moves from zooming the page', () => {
    stop = lockPageZoom();
    const g = new Event('gesturestart', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(g);
    expect(g.defaultPrevented).toBe(true);
    expect(touchMove(2).defaultPrevented).toBe(true);
    // 한 손가락 끌기(목록 넘기기)는 그대로
    expect(touchMove(1).defaultPrevented).toBe(false);
  });

  it('stop removes the listeners', () => {
    stop = lockPageZoom();
    stop();
    stop = null;
    expect(touchMove(2).defaultPrevented).toBe(false);
  });
});
