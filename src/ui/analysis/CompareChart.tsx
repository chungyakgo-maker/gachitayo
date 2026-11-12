// 두 랩 비교 그래프 (사양서 8.6, uPlot): 가로축 코스 거리. 속도(A·B) / 델타(A − B) / 고도(A).
// 그래프를 누르거나 끌면 그 거리를 고른다(지도·지점 정보와 이어짐). uPlot은 이 화면을 열 때 따로 불러온다.
import { useEffect, useRef } from 'react';
import type { CompareSeries } from './compare';

export type ChartKind = 'speed' | 'delta' | 'alt';

type UPlot = import('uplot');

export function CompareChart({ series, kind, selectedX, onSelect }: { series: CompareSeries; kind: ChartKind; selectedX: number | null; onSelect: (x: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const plot = useRef<UPlot | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    void (async () => {
      try {
        const [{ default: uPlot }] = await Promise.all([import('uplot'), import('uplot/dist/uPlot.min.css')]);
        if (!alive || !el.current) return;
        const width = el.current.clientWidth || 360;
        const axis = { stroke: '#9aa1a9', grid: { stroke: '#22262b', width: 1 }, ticks: { stroke: '#22262b', width: 1 }, font: '11px IBM Plex Mono, monospace' };
        const data: (number | null)[][] =
          kind === 'speed' ? [series.x, series.speedA, series.speedB] : kind === 'delta' ? [series.x, series.delta] : [series.x, series.altA];
        const lines =
          kind === 'speed'
            ? [
                { label: 'A km/h', stroke: '#aacae6', width: 2 },
                { label: 'B km/h', stroke: '#9aa1a9', width: 1.5, dash: [6, 4] },
              ]
            : kind === 'delta'
              ? [{ label: 'A − B 초', stroke: '#ff5b4f', width: 2 }]
              : [{ label: 'A 고도 m', stroke: '#aacae6', width: 2 }];
        plot.current?.destroy();
        plot.current = new uPlot(
          {
            width,
            height: 200,
            legend: { show: false },
            cursor: { y: false, drag: { x: false, y: false }, points: { show: false } },
            scales: { x: { time: false } },
            axes: [
              { ...axis, values: (_u: UPlot, v: number[]) => v.map((m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`)) },
              { ...axis, size: 44 },
            ],
            series: [{}, ...lines],
          },
          data as unknown as import('uplot').AlignedData,
          el.current,
        );
        // 손가락으로 누르거나 끌면 그 거리를 고른다
        const over = plot.current.over;
        const pickAt = (clientX: number) => {
          const u = plot.current;
          if (!u) return;
          const r = over.getBoundingClientRect();
          const x = u.posToVal(clientX - r.left, 'x');
          if (Number.isFinite(x)) select.current(Math.max(0, x));
        };
        over.addEventListener('pointerdown', (e: PointerEvent) => pickAt(e.clientX));
        over.addEventListener('pointermove', (e: PointerEvent) => {
          if (e.buttons || e.pointerType === 'touch') pickAt(e.clientX);
        });
        ro = new ResizeObserver(() => {
          const w = el.current?.clientWidth;
          if (w && plot.current) plot.current.setSize({ width: w, height: 200 });
        });
        ro.observe(el.current);
      } catch {
        // 그래프를 그릴 수 없는 환경
      }
    })();
    return () => {
      alive = false;
      ro?.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [series, kind]);

  useEffect(() => {
    const u = plot.current;
    if (!u || selectedX === null) return;
    u.setCursor({ left: u.valToPos(selectedX, 'x'), top: 20 });
  }, [selectedX]);

  const label = kind === 'speed' ? '속도 그래프: 랩 A와 B' : kind === 'delta' ? '델타 그래프: 랩 A − 랩 B' : '고도 그래프: 랩 A';
  return <div ref={el} className="compare-chart" role="img" aria-label={label} />;
}
