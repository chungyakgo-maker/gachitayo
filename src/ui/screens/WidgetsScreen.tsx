// 상단 표시 값 (디자인 시안 Widgets, 사용자 요청): 지도 모드 위쪽 세 칸. 칸 1(위 넓은 칸)은 델타 또는 표시 안 함,
// 칸 2(왼쪽)·칸 3(오른쪽)은 고른 값(표지판·표시 안 함 포함). 같은 값을 고르면 두 칸이 서로 바뀐다(표시 안 함은 둘 다 가능).
import { setWidget, updateSettings, useSettings, WIDGET_LABEL, type WidgetId } from '../../app/settings';
import { IconBack } from '../icons';
import { PaceNoteSign } from '../components/PaceNoteSign';

const SAMPLE: Record<Exclude<WidgetId, 'pace' | 'none'>, string> = {
  g: '좌 0.82 · 제동 0.31',
  speed: '142 km/h',
  lap: '1:12.4',
  sector: 'S2 −0.19',
  vmax: '186 km/h',
  lapno: '랩 4',
  gap: '2.4초',
};
const IDS = Object.keys(WIDGET_LABEL) as WidgetId[];

const tileStyle = { minWidth: 0, padding: '10px 12px', borderRadius: 12, background: 'var(--tile)', border: '1px solid var(--tile-line)', minHeight: 64 } as const;
const emptyStyle = { ...tileStyle, background: 'none', border: '1px dashed var(--line-strong)', justifyContent: 'center', alignItems: 'center' } as const;

function Preview({ id, slot }: { id: WidgetId; slot: number }) {
  if (id === 'none') {
    return (
      <div className="card-col" style={emptyStyle}>
        <span style={{ fontSize: 11 }} className="dim">
          칸 {slot} · 표시 안 함
        </span>
      </div>
    );
  }
  if (id === 'pace') {
    return (
      <div className="card-row" style={{ gap: 8, alignItems: 'center', justifyContent: 'flex-start', minHeight: 64 }}>
        <PaceNoteSign dir="left" grade={3} size={60} />
        <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
          120<small style={{ fontSize: 12 }}>m</small>
        </span>
      </div>
    );
  }
  return (
    <div className="card-col" style={tileStyle}>
      <span style={{ fontSize: 11 }} className="dim">
        칸 {slot} · {WIDGET_LABEL[id]}
      </span>
      <span className="mono" style={{ fontSize: id === 'g' ? 15 : 18, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {SAMPLE[id]}
      </span>
    </div>
  );
}

export function WidgetsScreen({ back }: { back: string }) {
  const { topDelta, widgets } = useSettings();
  return (
    <main className="page page-full">
      <header className="page-head">
        <a className="back-btn" href={back} aria-label="뒤로">
          <IconBack size={24} />
        </a>
        <h1>상단 표시 값</h1>
      </header>
      <section aria-label="미리보기" className="card-col" style={{ gap: 8, padding: 12, borderRadius: 18, background: 'var(--bg-drive)', border: '1px solid var(--card-line)' }}>
        {topDelta ? (
          <div className="delta-panel fast card-row" style={{ padding: '10px 14px', borderRadius: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>칸 1 · 델타</span>
            <span className="delta-text" style={{ fontSize: 36 }}>
              −0.31
            </span>
          </div>
        ) : (
          <div className="card-col" style={{ ...emptyStyle, minHeight: 40 }}>
            <span style={{ fontSize: 11 }} className="dim">
              칸 1 · 표시 안 함
            </span>
          </div>
        )}
        <div className="widget-row" style={{ gap: 8 }}>
          {widgets.map((w, i) => (
            <Preview key={i} id={w} slot={i + 2} />
          ))}
        </div>
      </section>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }} className="dim">
        표시 안 함을 고르면 그 칸을 비워 지도가 보여요. 같은 값을 고르면 두 칸이 서로 바뀝니다. 표지판은 코스를 골라 달릴 때 다음 커브를 보여 줘요. 속도는 지도 오른쪽 아래에 늘 보여요.
      </p>
      <section aria-label="칸 1 (위)" className="card-col" style={{ gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>칸 1 (위)</h2>
        <div className="chips">
          <button type="button" aria-pressed={topDelta} onClick={() => updateSettings({ topDelta: true })}>
            델타
          </button>
          <button type="button" aria-pressed={!topDelta} onClick={() => updateSettings({ topDelta: false })}>
            {WIDGET_LABEL.none}
          </button>
        </div>
      </section>
      {([0, 1] as const).map((slot) => {
        const name = slot === 0 ? '칸 2 (왼쪽)' : '칸 3 (오른쪽)';
        return (
          <section key={slot} aria-label={name} className="card-col" style={{ gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{name}</h2>
            <div className="chips">
              {IDS.map((id) => (
                <button key={id} type="button" aria-pressed={widgets[slot] === id} onClick={() => setWidget(slot, id)}>
                  {WIDGET_LABEL[id]}
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <div style={{ flex: 1 }} />
      <a className="primary-btn" href={back}>
        완료
      </a>
    </main>
  );
}
