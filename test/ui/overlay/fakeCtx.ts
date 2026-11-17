// 그리기 호출을 기록하는 가짜 캔버스 (jsdom에는 캔버스가 없다)
export interface Call {
  op: string;
  args: unknown[];
  /** 그 순간의 그리기 상태 */
  fillStyle: unknown;
  strokeStyle: unknown;
  font: unknown;
  lineDash: number[];
}

export function fakeCtx() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif', letterSpacing: '0px' };
  let dash: number[] = [];
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (s: string) => ({ width: s.length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? '10') * 0.6) });
      if (prop === 'setLineDash') return (d: number[]) => (dash = [...d]);
      if (prop === 'getLineDash') return () => dash;
      // 그라데이션: 색 칸만 받는 물건 (만든 것은 기록)
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient')
        return (...args: unknown[]) => {
          calls.push({ op: prop, args, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, font: state.font, lineDash: dash });
          return { gradient: prop, addColorStop: () => {} };
        };
      return (...args: unknown[]) => {
        calls.push({ op: prop, args, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, font: state.font, lineDash: dash });
      };
    },
    set(target, prop: string, v) {
      target[prop] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const texts = () => calls.filter((c) => c.op === 'fillText').map((c) => ({ text: c.args[0] as string, x: c.args[1] as number, y: c.args[2] as number, color: c.fillStyle, font: c.font }));
  return { ctx, calls, texts };
}
