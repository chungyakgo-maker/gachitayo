// 개발자 메뉴 › 기울기 시험 (2026-11-19 세영 "기울기가 부정확해 웹에서 테스트하게"): 폰을 거치하고 센서 기울기·계산 기울기·최종 값을
// 나란히 본다. 주행 준비(센서 켜기)를 열어 쓰고, 끝내면 그 준비를 지운다 (기록이 남지 않는다).
// 준비 상태에서도 달리면 값이 움직인다 — 랩은 재지 않는다
import { useState } from 'react';
import { beginPrepare, cancelPrepare, useDrive, useLiveSnapshot, zeroLean } from '../../app/drive';
import { leanFused } from '../../features';
import { formatLean, LEAN_REF_TEXT, LEAN_WAIT_TEXT, ZERO_FAIL_TEXT } from '../components/LeanZeroCard';
import { IconBack } from '../icons';

const REF_SHORT = { user: '직접 맞춤', auto: '달리며 자동', still: '정차 자세', none: '없음' } as const;

export function LeanTestScreen() {
  const d = useDrive();
  const snap = useLiveSnapshot();
  const [note, setNote] = useState<string | null>(null);
  const running = d.phase !== 'idle' && !d.replay;
  const back = d.phase === 'preparing' ? '#/prepare' : d.phase === 'driving' ? '#/drive' : '#/settings';
  const start = () => {
    // 아이폰 동작 센서 허락은 탭 안에서 물어야 해서 여기서 바로 연다. 준비 화면 대신 이 화면에 머문다
    beginPrepare();
    window.location.hash = '#/dev/lean';
  };
  const lean = snap?.lean;

  return (
    <main className="page" style={{ gap: 12 }}>
      <header className="page-head">
        <a className="back-btn" href={back} aria-label="뒤로">
          <IconBack size={24} />
        </a>
        <h1 style={{ flex: 1 }}>기울기 시험</h1>
      </header>
      {!running ? (
        <>
          <span className="sub">폰을 바이크에 거치하고 시작하세요. 동작 센서를 켜려고 주행 준비를 열어요. 기록은 남지 않아요.</span>
          <button type="button" className="primary-btn" onClick={start}>
            시험 시작
          </button>
        </>
      ) : !leanFused() ? (
        <div className="notice">기울기 시험은 웹에서만 할 수 있어요</div>
      ) : !lean ? (
        <>
          <div className="notice">{LEAN_WAIT_TEXT}</div>
          {d.phase === 'preparing' && (
            <button type="button" className="ghost-btn" onClick={() => void cancelPrepare()}>
              시험 끝내기
            </button>
          )}
        </>
      ) : (
        <>
          <ul className="card card-col lean-test" aria-label="기울기 값" style={{ gap: 10, listStyle: 'none', margin: 0 }}>
            <li className="card-row" style={{ justifyContent: 'space-between' }}>
              <span className="label">센서 기울기</span>
              <strong className="mono" style={{ fontSize: 24 }}>{formatLean(lean.tiltDeg)}</strong>
            </li>
            <li className="card-row" style={{ justifyContent: 'space-between' }}>
              <span className="label">계산 기울기</span>
              <strong className="mono" style={{ fontSize: 24 }}>{formatLean(lean.physicsDeg)}</strong>
            </li>
            <li className="card-row" style={{ justifyContent: 'space-between' }}>
              <span className="label">최종</span>
              <strong className="mono" style={{ fontSize: 32 }}>{formatLean(lean.deg)}</strong>
            </li>
            <li className="card-row" style={{ justifyContent: 'space-between' }}>
              <span className="label">속도</span>
              <strong className="mono" style={{ fontSize: 20 }}>{Math.round(snap?.state?.speedKmh ?? 0)} km/h</strong>
            </li>
          </ul>
          <span className="sub">0점: {REF_SHORT[lean.ref]}</span>
          <span className="sub">{LEAN_REF_TEXT[lean.ref]}</span>
          <span className="sub">센서 기울기 = 폰이 0점에서 기운 각도 · 계산 기울기 = 속도 × 도는 빠르기 · 최종 = 둘을 더한 값 (화면 기울기)</span>
          {note && (
            <span className="notice" role="status">
              {note}
            </span>
          )}
          <button type="button" className="btn" onClick={() => setNote(zeroLean() ? '0점을 맞췄어요' : ZERO_FAIL_TEXT)}>
            0점 맞추기
          </button>
          {d.phase === 'preparing' && (
            <button type="button" className="ghost-btn" onClick={() => void cancelPrepare()}>
              시험 끝내기
            </button>
          )}
        </>
      )}
    </main>
  );
}
