// 오버레이 그리기 함수(src/ui/overlay)를 화면에 붙이는 캔버스. 크기에 맞춰 기기 배율로 그리고,
// 글꼴이 늦게 내려오면 다시 그린다. 화면 읽기 프로그램에는 label을 읽어 준다.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useElementSize } from '../hooks/useElementSize';

export interface OverlayCanvasProps {
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  label: string;
  className?: string;
  style?: CSSProperties;
}

export function OverlayCanvas({ draw, label, className, style }: OverlayCanvasProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, setFontTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => alive && setFontTick((t) => t + 1));
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const W = Math.max(1, Math.round(width * dpr));
    const H = Math.max(1, Math.round(height * dpr));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height);
  });

  return (
    <div ref={ref} className={className} style={{ position: 'relative', ...style }}>
      <canvas ref={canvas} role="img" aria-label={label} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
