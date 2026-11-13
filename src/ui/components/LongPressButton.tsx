// "길게 눌러 종료" (사양서 8.4): 1초 동안 누르고 있어야 동작한다 (사용자 요청으로 2초에서 줄임). 누르는 동안 채워지는 막대로 보여준다.
import { useEffect, useRef, useState } from 'react';

export function LongPressButton({ onDone, holdMs = 1000, tall = false, label = '길게 눌러 종료' }: { onDone: () => void; holdMs?: number; tall?: boolean; label?: string }) {
  const [progress, setProgress] = useState(0);
  const start = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    start.current = null;
    setProgress(0);
  };
  const begin = () => {
    if (timer.current) return;
    start.current = Date.now();
    timer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - start.current!) / holdMs);
      setProgress(p);
      if (p >= 1) {
        stop();
        onDone();
      }
    }, 50);
  };
  useEffect(() => stop, []);

  return (
    <button
      type="button"
      className={`end-btn${tall ? ' tall' : ''}`}
      aria-label={`${label} (${holdMs / 1000}초)`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        begin();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') begin();
      }}
      onKeyUp={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="fill" style={{ transform: `scaleX(${progress})` }} />
      {/* 보이는 글자는 짧게 "종료" (사용자 요청: 1/3 크기로 줄여 맨 아래 가운데). 길게 누르라는 안내는 화면 읽기 이름에. 누르는 동안 막대가 찬다 */}
      <span>종료</span>
    </button>
  );
}
