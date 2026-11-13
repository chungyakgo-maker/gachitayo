// 설정 탭 (사양서 8.8): 닉네임, 친구, 동기화 상태, 기본 화면 모드, 상단 표시 값, 델타 색, 게이트 폭, 거치 팁, 개발자 메뉴.
import { DriveFriendsToggle } from '../components/DriveFriendsToggle';
import { useEffect, useState } from 'react';
import { friendlyServerError, recreateAccount, updateNickname, useAccount } from '../../app/account';
import { getProviders, startKakaoLogin } from '../../app/kakaoLogin';
import { logout, logoutCheck } from '../../app/logout';
import { KakaoButton } from '../components/KakaoButton';
import { KakaoPendingCard } from '../components/KakaoPendingCard';
import { RestoreBanner } from '../components/RestoreBanner';
import { Overlay } from '../components/Overlay';
import { G_MAX_OPTIONS, GATE_WIDTH_MAX_M, GATE_WIDTH_MIN_M, CURVE_TINT_LABEL, MAP_VIEW_LABEL, updateSettings, useSettings, topSummary, type CurveTint, type DeltaPalette, type DriveMode } from '../../app/settings';
import { MountTips } from '../components/MountTips';
import { retryNow, useSync } from '../../app/sync';
import { buildInfo } from '../buildInfo';
import { FriendsSection } from '../components/FriendsSection';
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

/** 카카오 로그인·로그아웃 (설계 5.6) */
function KakaoAccount() {
  const acc = useAccount();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ localOnly: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void getProviders().then((p) => alive && setOn(p.kakao));
    return () => {
      alive = false;
    };
  }, []);
  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      await startKakaoLogin('#/settings');
    } catch (e) {
      setError(friendlyServerError(e));
      setBusy(false);
    }
  };
  const askLogout = async () => {
    setBusy(true);
    setError(null);
    const c = await logoutCheck();
    setBusy(false);
    if (c.ok) setAsk({ localOnly: c.localOnly });
    else setError(c.error);
  };
  const doLogout = async () => {
    setBusy(true);
    const r = await logout();
    if (!r.ok) {
      setBusy(false);
      setAsk(null);
      setError(r.error);
    }
  };
  return (
    <>
      <KakaoPendingCard />
      {acc.kakao ? (
        <div className="card-row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontWeight: 600 }}>카카오 연결됨</span>
          <button type="button" className="btn" disabled={busy} onClick={() => void askLogout()}>
            로그아웃
          </button>
        </div>
      ) : (
        on &&
        (acc.status === 'ready' || acc.lost) && (
          <div className="card-col" style={{ gap: 6 }}>
            <KakaoButton label="카카오로 로그인" disabled={busy} onClick={() => void login()} />
            <span className="sub">{acc.lost ? '예전에 카카오로 연결했다면 이걸로 돌아와요' : '로그인하면 폰을 바꿔도 기록이 돌아와요'}</span>
          </div>
        )
      )}
      <RestoreBanner />
      {error && <div className="notice warn">{error}</div>}
      {ask && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="logout-title">
              <h2 id="logout-title">로그아웃할까요?</h2>
              <p>로그아웃하면 이 폰의 기록과 내 코스가 지워져요. 다시 로그인하면 서버에서 되살아나요.</p>
              {ask.localOnly > 0 && <p className="warn-text">{`이 폰에만 있는 기록 ${ask.localOnly}개는 되살릴 수 없어요.`}</p>}
              <div className="modal-actions">
                <button type="button" className="btn danger" disabled={busy} onClick={() => void doLogout()}>
                  로그아웃
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setAsk(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}

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
      <KakaoAccount />
      <span className="sub" style={{ lineHeight: 1.6 }}>
        {acc.status === 'disabled'
          ? '서버 연결 전이라 기록은 이 폰에만 있어요.'
          : acc.kakao
            ? '카카오 계정에 연결돼 있어요. 폰을 바꿔도 카카오로 로그인하면 기록이 돌아와요.'
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
        <FriendsSection />
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
        <section className="card-col" style={{ gap: 8 }} aria-label="지도 보기">
          <span className="label">주행 지도 보기 (지도 모드)</span>
          <div className="segmented small" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {(['fit', 'follow', 'heading'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={s.mapView === k} onClick={() => updateSettings({ mapView: k })}>
                {MAP_VIEW_LABEL[k]}
              </button>
            ))}
          </div>
        </section>
        <section className="card-col" style={{ gap: 8 }} aria-label="주행 중 바탕 지도">
          <span className="label">주행 중 바탕 지도 (지도 모드)</span>
          <div className="segmented small" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            {([
              [true, '보이기'],
              [false, '끄기 (코스 선만)'],
            ] as const).map(([v, label]) => (
              <button key={label} type="button" aria-pressed={s.mapTiles === v} onClick={() => updateSettings({ mapTiles: v })}>
                {label}
              </button>
            ))}
          </div>
          <span className="sub">통신이 없으면 저절로 코스 선만 그려요. 끄면 데이터와 배터리를 덜 써요.</span>
        </section>
        <DriveFriendsToggle />
        <section className="card-col" style={{ gap: 8 }} aria-label="커브 방향 화면 색">
          <span className="label">커브 방향 화면 색</span>
          <div className="chips">
            {(Object.keys(CURVE_TINT_LABEL) as CurveTint[]).map((k) => (
              <button key={k} type="button" aria-pressed={s.curveTint === k} onClick={() => updateSettings({ curveTint: k })}>
                {CURVE_TINT_LABEL[k]}
              </button>
            ))}
          </div>
          <span className="sub">코스를 달릴 때 다음 커브 방향을 표지판 색(왼쪽 파랑 · 오른쪽 빨강)으로 화면에 덮어요. A 화면 전체 고르게, B 화면 전체를 가까울수록 진하게, C 네 가장자리, D 커브 쪽 가장자리만 가까울수록 진하게.</span>
        </section>
        <section className="card-col" style={{ gap: 8 }} aria-label="G미터 최대값">
          <span className="label">G미터 최대값 (바깥 원)</span>
          <div className="segmented small" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            {G_MAX_OPTIONS.map((g) => (
              <button key={g} type="button" aria-pressed={s.gMaxG === g} onClick={() => updateSettings({ gMaxG: g })}>
                {g}g
              </button>
            ))}
          </div>
        </section>
        <a className="list-link" href="#/settings/widgets">
          <span className="card-col" style={{ gap: 3 }}>
            <span className="label">상단 표시 값 (지도 모드)</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {topSummary(s)}
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
        <section className="card-col" style={{ gap: 8 }} aria-label="게이트 폭">
          <span className="label">게이트 폭 (지도·GPX로 만드는 새 코스)</span>
          <div className="stepper" role="group" aria-label="게이트 폭">
            <button type="button" aria-label="게이트 폭 줄이기" disabled={s.gateWidthM <= GATE_WIDTH_MIN_M} onClick={() => updateSettings({ gateWidthM: Math.max(GATE_WIDTH_MIN_M, s.gateWidthM - 5) })}>
              −
            </button>
            <span className="mono">{s.gateWidthM} m</span>
            <button type="button" aria-label="게이트 폭 늘리기" disabled={s.gateWidthM >= GATE_WIDTH_MAX_M} onClick={() => updateSettings({ gateWidthM: Math.min(GATE_WIDTH_MAX_M, s.gateWidthM + 5) })}>
              +
            </button>
          </div>
          <span className="sub">출발선·도착선을 통과했다고 보는 폭이에요. 길이 넓거나 GPS가 흔들리면 넓게.</span>
        </section>
        <details className="card tips-card">
          <summary>거치 팁</summary>
          <MountTips />
        </details>
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
