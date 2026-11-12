// 설정 탭 (사양서 8.8 중 화면 관련): 기본 화면 모드, 상단 표시 값, 델타 색, 개발자 메뉴.
// 닉네임·게이트 폭·동기화 상태는 서버 연결(다음 단계) 때 넣는다.
import { updateSettings, useSettings, WIDGET_LABEL, type DeltaPalette, type DriveMode } from '../../app/settings';
import { buildInfo } from '../buildInfo';
import { Tabbed } from '../components/TabBar';
import { formatKst } from '../format';
import { IconChevron } from '../icons';

const MODES: Array<[DriveMode, string]> = [
  ['map', '지도'],
  ['minimal', '미니멀'],
  ['dashboard', '대시보드'],
];
const PALETTES: Array<[DeltaPalette, string, string, string]> = [
  ['green-red', '초록·빨강', '#3EE08F', '#FF5B4F'],
  ['blue-orange', '파랑·주황', '#5CB8FF', '#E8690F'],
];

export function SettingsScreen() {
  const s = useSettings();
  return (
    <Tabbed path="/settings">
      <main className="page">
        <header className="page-head">
          <h1 className="big">설정</h1>
        </header>
        <section className="card-col" style={{ gap: 8 }} aria-label="기본 화면 모드">
          <span className="label">기본 화면 모드</span>
          <div className="segmented" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {MODES.map(([m, label]) => (
              <button key={m} type="button" aria-pressed={s.defaultMode === m} onClick={() => updateSettings({ defaultMode: m })}>
                {label}
              </button>
            ))}
          </div>
        </section>
        <a className="list-link" href="#/settings/widgets">
          <span className="card-col" style={{ gap: 3 }}>
            <span className="label">상단 표시 값 (지도 모드)</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              델타 + {WIDGET_LABEL[s.widgets[0]]} · {WIDGET_LABEL[s.widgets[1]]}
            </span>
          </span>
          <IconChevron size={20} color="#9AA1A9" />
        </a>
        <section className="card-col" style={{ gap: 8 }} aria-label="델타 색">
          <span className="label">델타 색 (빠름 · 느림)</span>
          <div className="segmented" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            {PALETTES.map(([p, label, fast, slow]) => (
              <button key={p} type="button" aria-pressed={s.deltaPalette === p} onClick={() => updateSettings({ deltaPalette: p })}>
                <span className="mono" style={{ color: fast, fontWeight: 700 }}>
                  −0.31
                </span>{' '}
                <span className="mono" style={{ color: slow, fontWeight: 700 }}>
                  +0.42
                </span>{' '}
                <span style={{ fontSize: 12 }}>{label}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card-col" style={{ gap: 8 }} aria-label="개발자 메뉴">
          <span className="label">개발자 메뉴</span>
          <a className="list-link" href="#/dev/replay">
            <span className="card-col" style={{ gap: 3 }}>
              <strong style={{ fontSize: 15 }}>재생 모드</strong>
              <span className="sub">저장된 기록이나 가상 주행을 주행 화면에 흘려 확인</span>
            </span>
            <IconChevron size={20} color="#9AA1A9" />
          </a>
          <a className="list-link" href="#/dev/recorder">
            <span className="card-col" style={{ gap: 3 }}>
              <strong style={{ fontSize: 15 }}>센서 기록 테스트</strong>
              <span className="sub">원본 파일(.json.gz / .json) 내보내기</span>
            </span>
            <IconChevron size={20} color="#9AA1A9" />
          </a>
        </section>
        <footer className="build-info">
          버전 {buildInfo.version} · {formatKst(Date.parse(buildInfo.builtAt))} 빌드
        </footer>
      </main>
    </Tabbed>
  );
}
