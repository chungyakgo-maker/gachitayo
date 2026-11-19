// 설정 탭 (사양서 8.8): 닉네임, 친구, 저장 공간·백업(기록은 폰에만), 기본 화면 모드, 상단 표시 값, 델타 색, 게이트 폭, 거치 팁, 개발자 메뉴.
import { buildChannel, locationSharing } from '../../features';
import { DriveFriendsToggle } from '../components/DriveFriendsToggle';
import { useEffect, useState } from 'react';
import { friendlyServerError, recreateAccount, signedIn, updateNickname, useAccount } from '../../app/account';
import { startAppleLogin } from '../../app/appleLogin';
import { AppleButton } from '../components/AppleButton';
import { LoginChooser } from '../components/LoginChooser';
import { deleteAccount } from '../../app/deleteAccount';
import { getProviders, startKakaoLogin } from '../../app/kakaoLogin';
import { logout, logoutCheck } from '../../app/logout';
import { shareBackup } from '../../app/backup';
import { KakaoButton } from '../components/KakaoButton';
import { KakaoPendingCard } from '../components/KakaoPendingCard';
import { RestoreBanner } from '../components/RestoreBanner';
import { Overlay } from '../components/Overlay';
import { isApp } from '../../platform';
import { LegalLink } from '../legal';
import { G_MAX_OPTIONS, GATE_WIDTH_MAX_M, GATE_WIDTH_MIN_M, BIKE_MARKER_LABEL, CAR_MARKER_LABEL, CURVE_TINT_LABEL, VEHICLE_LABEL, MAP_VIEW_LABEL, effectiveSettings, setVehicle, updateSettings, useSettings, topSummary, type BikeMarker, type CarMarker, type CurveTint, type Vehicle, type DeltaPalette, type DriveMode } from '../../app/settings';
import { OverlayCanvas } from '../components/OverlayCanvas';
import { drawMeIcon } from '../overlay/minimap';
import { MountTips } from '../components/MountTips';
import { buildInfo } from '../buildInfo';
import { FriendsSection } from '../components/FriendsSection';
import { ProfilePhoto } from '../components/ProfilePhoto';
import { TeamsSection } from '../components/TeamsSection';
import { StorageSection } from '../components/StorageSection';
import { BackupSection } from '../components/BackupSection';
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

/** 카카오·애플 로그인·로그아웃 (카카오 설계 5.6, 앱 로그인 설계 2026-11-17: 애플은 아이폰 앱만) */
function LoginAccount() {
  const acc = useAccount();
  const [on, setOn] = useState(false);
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const [wipe, setWipe] = useState(false);
  useEffect(() => {
    let alive = true;
    void getProviders().then((p) => {
      if (!alive) return;
      setOn(p.kakao);
      setApple(p.apple);
    });
    return () => {
      alive = false;
    };
  }, []);
  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      // 앱에서 로그인 창을 닫으면 버튼을 다시 쓸 수 있게 (검토 지적)
      if ((await startKakaoLogin('#/settings')) === 'cancelled') setBusy(false);
    } catch (e) {
      setError(friendlyServerError(e));
      setBusy(false);
    }
  };
  const appleLogin = async () => {
    setBusy(true);
    setError(null);
    const r = await startAppleLogin();
    setBusy(false);
    // 이 폰의 계정이 다른 계정으로 바뀌었으면 화면을 다시 연다 (예전 계정의 친구·방 연결 비우기)
    if (r.ok && r.changed) window.location.reload();
    if (!r.ok && 'error' in r) setError(r.error);
  };
  const askLogout = async () => {
    setBusy(true);
    setError(null);
    const c = await logoutCheck();
    setBusy(false);
    if (c.ok) {
      setWipe(false);
      setAsk(true);
    } else setError(c.error);
  };
  const doLogout = async () => {
    setBusy(true);
    const r = await logout({ wipe });
    if (!r.ok) {
      setBusy(false);
      setAsk(false);
      setError(r.error);
    }
  };
  return (
    <>
      <KakaoPendingCard />
      {signedIn(acc) ? (
        <>
          <div className="card-row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontWeight: 600 }}>{[acc.kakao && '카카오', acc.apple && 'Apple'].filter(Boolean).join(' · ')} 연결됨</span>
            <button type="button" className="btn" disabled={busy} onClick={() => void askLogout()}>
              로그아웃
            </button>
          </div>
          {/* 아직 안 붙인 로그인도 이 계정에 붙일 수 있게 (검토 지적: 애플만 붙은 계정은 웹에서 들어올 수 없었다) */}
          {((on && !acc.kakao) || (apple && !acc.apple)) && (
            <div className="card-col" style={{ gap: 8 }}>
              {on && !acc.kakao && <KakaoButton label="카카오도 연결하기" disabled={busy} onClick={() => void login()} />}
              {apple && !acc.apple && <AppleButton label="Apple도 연결하기" disabled={busy} onClick={() => void appleLogin()} />}
              <span className="sub">{on && !acc.kakao ? '카카오를 연결하면 웹에서도 이 계정으로 들어올 수 있어요' : '어느 쪽으로 로그인해도 같은 계정으로 들어와요'}</span>
            </div>
          )}
        </>
      ) : (
        (on || apple) &&
        (acc.status === 'ready' || acc.lost) && (
          <div className="card-col" style={{ gap: 8 }}>
            <LoginChooser kakao={on} apple={apple} kakaoLabel="카카오로 로그인" disabled={busy} onKakao={() => void login()} onApple={() => void appleLogin()} />
            <span className="sub">
              {acc.lost ? `예전에 ${apple ? '카카오나 Apple로' : '카카오로'} 연결했다면 이걸로 돌아와요` : '로그인하면 친구·팀을 쓸 수 있어요 · 기록은 이 폰에만 저장돼요'}
            </span>
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
              <p>로그아웃해도 이 폰의 기록과 내 코스는 그대로 남아요. 친구·팀은 다시 로그인하면 돌아와요.</p>
              <WipeChoice wipe={wipe} onWipe={setWipe} disabled={busy} />
              <div className="modal-actions">
                <button type="button" className="btn danger" disabled={busy} onClick={() => void doLogout()}>
                  로그아웃
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setAsk(false)}>
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
      <ProfilePhoto />
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
          <span>아직 서버 계정을 만들지 못했어요. 통신이 연결되면 자동으로 만들어요.</span>
          <button type="button" className="btn" disabled={acc.busy} onClick={() => void recreateAccount()}>
            지금 계정 만들기
          </button>
        </div>
      )}
      {acc.status === 'none' && acc.lost && (
        <div className="notice warn" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span>계정 연결이 끊겼어요. 새 계정으로 다시 시작하면 친구·팀을 다시 쓸 수 있어요. 이 폰의 기록은 그대로예요.</span>
          <button type="button" className="btn" disabled={acc.busy} onClick={() => void recreateAccount()}>
            새 계정 만들기
          </button>
        </div>
      )}
      {acc.error && <div className="notice warn">{acc.error}</div>}
      <LoginAccount />
      <span className="sub" style={{ lineHeight: 1.6 }}>
        {acc.status === 'disabled'
          ? '서버 연결 전이라 기록은 이 폰에만 있어요.'
          : signedIn(acc)
            ? `${acc.kakao ? '카카오' : 'Apple'} 계정에 연결돼 있어요. 폰을 바꿔도 같은 방법으로 로그인하면 친구·팀이 돌아와요. 기록은 이 폰에만 있어요.`
            : '익명 계정이라 브라우저 데이터를 지우거나 폰을 바꾸면 친구·팀이 있는 이 계정으로 다시 들어올 수 없어요. 기록은 이 폰에만 있으니 백업 파일을 만들어 두세요.'}
      </span>
    </section>
  );
}

/** 로그아웃·계정 지우기 창 (기록은 폰에만 6단계, 시안 ④): 기록은 기본으로 남기고, 체크하면 이 폰에서도 지운다. 지우기 전에 백업 */
function WipeChoice({ wipe, onWipe, disabled }: { wipe: boolean; onWipe: (v: boolean) => void; disabled: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <label className="check-row">
        <input type="checkbox" checked={wipe} disabled={disabled} onChange={(e) => onWipe(e.target.checked)} />
        기록과 내 코스도 이 폰에서 지우기
      </label>
      <button
        type="button"
        className="link-btn"
        disabled={disabled}
        onClick={() => {
          setNote(null);
          void shareBackup()
            .then((r) => setNote(r === 'cancelled' ? null : '백업 파일을 만들었어요'))
            .catch((e: Error) => setNote(e.message));
        }}
      >
        지우기 전에 백업 파일 만들기 ›
      </button>
      {note && <span className="sub">{note}</span>}
    </>
  );
}

/** 계정 삭제 (사양서 13.3, 애플 심사 필수): 확인 창에서 "지우기"를 눌러야 지운다 */
export function DeleteAccountSection() {
  const [ask, setAsk] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card-col" style={{ gap: 8 }} aria-label="계정 삭제">
      <span className="label">계정 삭제</span>
      <button
        type="button"
        className="btn danger"
        onClick={() => {
          setError(null);
          setWipe(false);
          setAsk(true);
        }}
      >
        계정 지우기
      </button>
      {ask && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="account-delete-title">
              <h2 id="account-delete-title">계정을 지울까요?</h2>
              <p>닉네임·친구·팀·프로필 사진·공개한 코스가 서버에서 지워지고 되돌릴 수 없어요.</p>
              <WipeChoice wipe={wipe} onWipe={setWipe} disabled={busy} />
              {error && <div className="notice warn">{error}</div>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    void deleteAccount({ wipe })
                      .catch((e: Error) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  지우기
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setAsk(false)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </Overlay>
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
        <TeamsSection />
        <StorageSection />
        <BackupSection />
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
        {/* 탈것 (2026-11-18 바이크 모드 시안): 바이크면 내 위치를 바이크로 그리고 길찾기가 고속도로·자동차전용도로를 피한다 */}
        <section className="card-col" style={{ gap: 8 }} aria-label="탈것">
          <span className="label">탈것</span>
          <div className="segmented small" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            {(Object.keys(VEHICLE_LABEL) as Vehicle[]).map((k) => (
              <button key={k} type="button" aria-pressed={s.vehicle === k} onClick={() => setVehicle(k)}>
                {VEHICLE_LABEL[k]}
              </button>
            ))}
          </div>
          <span className="sub">바이크면 길찾기에서 고속도로·자동차전용도로를 피해요.</span>
        </section>
        {/* 내 차 표시 (사용자 요청 시안 2026-11-17 "내 차 너무 작아서 안 보여"): 그림을 눌러 고른다. 바이크면 바이크 5종 */}
        {s.vehicle === 'bike' ? (
          <section className="card-col" style={{ gap: 8 }} aria-label="내 바이크 표시">
            <span className="label">내 바이크 표시 (주행 지도)</span>
            <div className="marker-pick five">
              {(Object.keys(BIKE_MARKER_LABEL) as BikeMarker[]).map((k) => (
                <button key={k} type="button" aria-label={BIKE_MARKER_LABEL[k]} aria-pressed={s.bikeMarker === k} onClick={() => updateSettings({ bikeMarker: k })}>
                  <OverlayCanvas className="marker-icon" label={BIKE_MARKER_LABEL[k]} draw={(ctx, w, h) => drawMeIcon(ctx, w, h, k)} />
                  <span aria-hidden="true">{BIKE_MARKER_LABEL[k]}</span>
                </button>
              ))}
            </div>
            <span className="sub">주행 화면 지도에서 내 위치를 이 모양으로 그려요.</span>
          </section>
        ) : (
          <section className="card-col" style={{ gap: 8 }} aria-label="내 차 표시">
            <span className="label">내 차 표시 (주행 지도)</span>
            <div className="marker-pick">
              {(Object.keys(CAR_MARKER_LABEL) as CarMarker[]).map((k) => (
                <button key={k} type="button" aria-label={CAR_MARKER_LABEL[k]} aria-pressed={s.carMarker === k} onClick={() => updateSettings({ carMarker: k })}>
                  <OverlayCanvas className="marker-icon" label={CAR_MARKER_LABEL[k]} draw={(ctx, w, h) => drawMeIcon(ctx, w, h, k)} />
                  <span aria-hidden="true">{CAR_MARKER_LABEL[k]}</span>
                </button>
              ))}
            </div>
            <span className="sub">주행 화면 지도에서 내 위치를 이 모양으로 그려요. 처음에는 화살표예요.</span>
          </section>
        )}
        {locationSharing() && <DriveFriendsToggle />}
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
              {topSummary(effectiveSettings(s))}
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
        <DeleteAccountSection />
        {/* 도움말 (설계 2026-11-18 help): 그림으로 보는 디고 사용법 */}
        <section className="card-col" style={{ gap: 8 }} aria-label="도움말">
          <span className="label">도움말</span>
          <a className="list-link" href="#/help">
            <span className="card-col" style={{ gap: 3 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>기능 알아보기</span>
              <span className="sub">그림으로 보는 디고 사용법</span>
            </span>
            <IconChevron size={20} color="#9AA1A9" />
          </a>
        </section>
        <section className="card-col" style={{ gap: 8 }} aria-label="약관">
          <span className="label">약관</span>
          <span style={{ fontSize: 15, display: 'flex', gap: 16 }}>
            <LegalLink kind="privacy">개인정보처리방침</LegalLink>
            <LegalLink kind="location">위치정보 이용약관</LegalLink>
          </span>
        </section>
        {/* 개발자 메뉴는 웹(개발자용)에만. 아이폰 앱에서는 숨긴다 (사양서 13.3) */}
        {!isApp() && (
          <section className="card-col" style={{ gap: 8 }} aria-label="개발자 메뉴">
            <span className="label">개발자 메뉴</span>
            <a className="list-link" href="#/dev/recorder">
              <span className="card-col" style={{ gap: 3 }}>
                <strong style={{ fontSize: 15 }}>센서 기록 테스트</strong>
                <span className="sub">원본 파일(.json.gz / .json) 내보내기</span>
              </span>
              <IconChevron size={20} color="#9AA1A9" />
            </a>
          </section>
        )}
        <footer className="build-info">
          {/* 아이폰 앱만: 정식(위치 공유 끔)·테스트 빌드 구별 (웹에는 안 보인다) */}
          {isApp() ? `${buildChannel()} · ` : ''}버전 {buildInfo.version} · {formatKst(Date.parse(buildInfo.builtAt))} 빌드
        </footer>
      </main>
    </Tabbed>
  );
}
