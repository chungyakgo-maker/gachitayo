// 상단 표시 값 (디자인 시안 Widgets): 지도 모드 위쪽에 델타와 함께 보여줄 두 칸.
// 같은 값을 고르면 두 칸이 서로 바뀐다. 앞 친구 간격(3단계)은 넣지 않는다.
import { setWidget, useSettings, WIDGET_LABEL, type WidgetId } from '../../app/settings';
import { IconBack } from '../icons';

const SAMPLE: Record<WidgetId, string> = {
  g: '좌 0.82 · 제동 0.31',
  speed: '142 km/h',
  lap: '1:12.4',
  sector: 'S2 −0.19',
  vmax: '186 km/h',
  lapno: '랩 4',
};
const IDS = Object.keys(WIDGET_LABEL) as WidgetId[];

export function WidgetsScreen({ back }: { back: string }) {
  const { widgets } = useSettings();
  return (
    <main className="page page-full">
      <header className="page-head">
        <a className="back-btn" href={back} aria-label="뒤로">
          <IconBack size={24} />
        </a>
        <h1>상단 표시 값</h1>
      </header>
      <section aria-label="미리보기" className="card-col" style={{ gap: 8, padding: 12, borderRadius: 18, background: 'var(--bg-drive)', border: '1px solid var(--card-line)' }}>
        <div className="delta-panel fast card-row" style={{ padding: '10px 14px', borderRadius: 14 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>델타 · 항상 표시</span>
          <span className="delta-text" style={{ fontSize: 36 }}>
            −0.31
          </span>
        </div>
        <div className="widget-row" style={{ gap: 8 }}>
          {widgets.map((w, i) => (
            <div key={i} className="card-col" style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--tile)', border: '1px solid var(--tile-line)' }}>
              <span style={{ fontSize: 11 }} className="dim">
                칸 {i + 1} · {WIDGET_LABEL[w]}
              </span>
              <span className="mono" style={{ fontSize: w === 'g' ? 15 : 18, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {SAMPLE[w]}
              </span>
            </div>
          ))}
        </div>
      </section>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }} className="dim">
        델타는 항상 크게 표시됩니다. 나머지 두 칸에 보여줄 값을 고르세요. 같은 값을 고르면 두 칸이 서로 바뀝니다.
      </p>
      {([0, 1] as const).map((slot) => (
        <section key={slot} aria-label={`칸 ${slot + 1}`} className="card-col" style={{ gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>칸 {slot + 1}</h2>
          <div className="chips">
            {IDS.map((id) => (
              <button key={id} type="button" aria-pressed={widgets[slot] === id} onClick={() => setWidget(slot, id)}>
                {WIDGET_LABEL[id]}
              </button>
            ))}
          </div>
        </section>
      ))}
      <div style={{ flex: 1 }} />
      <a className="primary-btn" href={back}>
        완료
      </a>
    </main>
  );
}
