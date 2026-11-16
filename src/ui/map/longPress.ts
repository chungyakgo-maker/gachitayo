// 지도 길게 눌러 고르기 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.4, 사용자 결정 "지도 찍기"):
// 손가락 하나로 550 ms 누르고 있으면 그 자리. 10 px 넘게 움직이거나(지도 끌기) 손가락이 둘이면(확대) 취소.
// 마우스 오른쪽 단추·안드로이드의 길게 누르기(contextmenu)도 같은 뜻. 터치로 고른 직후 따라오는 contextmenu는 한 번 더 세지 않는다.
// 지도 라이브러리와 따로 (선 지도·사진 지도가 같이 쓴다).

const CONTEXT_AFTER_TOUCH_MS = 800;

export function attachLongPress(el: HTMLElement, onPress: (clientX: number, clientY: number) => void, opts: { ms?: number; slopPx?: number } = {}): () => void {
  const ms = opts.ms ?? 550;
  const slop = opts.slopPx ?? 10;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let lastTouchPress = -Infinity;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    start = null;
  };
  const onStart = (e: TouchEvent) => {
    cancel();
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    start = { x: t.clientX, y: t.clientY };
    timer = setTimeout(() => {
      const s = start;
      timer = null;
      start = null;
      if (!s) return;
      lastTouchPress = Date.now();
      onPress(s.x, s.y);
    }, ms);
  };
  const onMove = (e: TouchEvent) => {
    if (!start) return;
    if (e.touches.length !== 1) return cancel();
    const t = e.touches[0]!;
    if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > slop) cancel();
  };
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    if (Date.now() - lastTouchPress < CONTEXT_AFTER_TOUCH_MS) return;
    cancel();
    onPress(e.clientX, e.clientY);
  };

  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('contextmenu', onContext);
  return () => {
    cancel();
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchmove', onMove);
    el.removeEventListener('touchend', cancel);
    el.removeEventListener('touchcancel', cancel);
    el.removeEventListener('contextmenu', onContext);
  };
}
