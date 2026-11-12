// 설정 탭 (사양서 8.8): 닉네임, 동기화 상태, 기본 화면 모드, 상단 표시 값, 델타 색, 개발자 메뉴.
// 게이트 폭은 코스 관리(M7)에서.
import { useState } from 'react';
import { recreateAccount, updateNickname, useAccount } from '../../app/account';
import { updateSettings, useSettings, WIDGET_LABEL, type DeltaPalette, type DriveMode } from '../../app/settings';
import { retryNow, useSync } from '../../app/sync';
import { buildInfo } from '../buildInfo';
import { Tabbed } from '../components/TabBar';
import { formatKst } from '../format';
import { IconCloud, IconWarn } from '../icons';
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

function AccountSection() {
  const acc = useAccount();
  const [name, setName] = useState(acc.nickname ?? '');
  const changed = name.trim() !== (acc.nickname ?? '');
  return (
    <section className="card-col" style={{ gap: 8 }}>
      <label htmlFor="settings-nickname" className="label">
        닉네임
      </label>
      <div className="name-row">
        <input id="settings-nickname" type="text" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        <button type="button" disabled={!changed || acc.busy} onClick={() => void updateNickname(name)}>
          저장
        </button>
      </div>
      {acc.status === 'none' && acc.onboarded && !acc.lost && (
        <div className="notice" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span>아직 서버 계정을 만들지 못했어요. 통신이 연결되면 자동으로 만들고 기록을 올려요.</span>
          <button type="button" className="btn" disabled={acc.busy} onClick={() => void recreateAccount()}>
            지금 계정 만들기
          </button>
        </div>
      )}
      {acc.status === 'none' && acc.lost && (
        <div className="notice warn" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span>계정 연결이 끊겼어요. 새 계정으로 다시 시작하면 이 폰의 기록은 다시 올라가지만, 예전 계정의 서버 기록은 볼 수 없어요.</span>
          <button type="button" className="btn" disabled={acc.busy} onClick={() => void recreateAccount()}>
            새 계정 만들기
          </button>
        </div>
      )}
      {acc.error && <div className="notice warn">{acc.error}</div>}
      <span className="sub" style={{ lineHeight: 1.6 }}>
        {acc.status === 'disabled'
          ? '서버 연결 전이라 기록은 이 폰에만 있어요.'
          : '익명 계정이라 브라우저 데이터를 지우거나 폰을 바꾸면 이 계정으로 다시 들어올 수 없어요(서버 기록은 남아요). 홈 화면 앱으로 쓰고 자주 올려 주세요.'}
      </span>
    </section>
  );
}

function SyncSection() {
  const sync = useSync();
  const acc = useAccount();
  const status = !sync.enabled
    ? '서버 연결 전 · 폰에만 저장'
    : acc.status !== 'ready'
      ? '계정이 없어 올리지 않음'
      : sync.running
        ? '올리는 중…'
        : sync.pending > 0
          ? `업로드 대기 ${sync.pending}건`
          : '모두 올라감';
  return (
    <section className="card card-col" style={{ gap: 8 }} aria-label="동기화 상태">
      <div className="status-head">
        {sync.lastError ? <IconWarn color="#FF5B4F" /> : <IconCloud color="#FFB224" />}
        <strong>동기화</strong>
        <span>{status}</span>
      </div>
      {sync.lastSyncAt && <span className="sub">마지막 업로드 {formatKst(sync.lastSyncAt)}</span>}
      {sync.lastError && <span style={{ fontSize: 13, color: 'var(--bad)' }}>마지막 오류: {sync.lastError}</span>}
      {sync.enabled && sync.pending > 0 && (
        <button type="button" className="btn" disabled={sync.running || acc.status !== 'ready'} onClick={() => void retryNow()}>
          지금 다시 시도
        </button>
      )}
    </section>
  );
}

export function SettingsScreen() {
  const s = useSettings();
  return (
    <Tabbed path="/settings">
      <main className="page">
        <header className="page-head">
          <h1 className="big">설정</h1>
        </header>
        <AccountSection />
        <SyncSection />
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
