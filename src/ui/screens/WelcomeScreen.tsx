// 첫 실행 (사양서 8.1): 닉네임(익명 계정 만들기), 권한·홈 화면 추가 안내, 안전 안내 확인
import { useState } from 'react';
import { finishOnboarding, useAccount } from '../../app/account';
import { IconPhone, IconPin, IconWarn } from '../icons';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () =>
  (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function WelcomeScreen() {
  const acc = useAccount();
  const [name, setName] = useState(acc.nickname ?? '');
  const [agree, setAgree] = useState(false);
  const ok = name.trim().length >= 1 && name.trim().length <= 20 && agree && !acc.busy;
  return (
    <main className="page page-full">
      <header className="card-col" style={{ gap: 6, paddingTop: 16 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>같이타요</h1>
        <span className="dim" style={{ fontSize: 14 }}>
          와인딩·서킷 랩타임과 베스트 대비 델타를 폰으로 재요
        </span>
      </header>

      <section className="card-col" style={{ gap: 8 }}>
        <label htmlFor="nickname" className="label">
          닉네임
        </label>
        <div className="name-row">
          <input id="nickname" type="text" placeholder="예: 민수" value={name} maxLength={20} autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
        </div>
        <span className="sub">
          {acc.status === 'disabled'
            ? '지금은 서버 연결 전이라 기록을 폰에만 저장해요.'
            : '가입 없이 이 폰에 익명 계정을 만들어요. 브라우저 데이터를 지우거나 폰을 바꾸면 이 계정으로 다시 들어올 수 없어요.'}
        </span>
      </section>

      <section className="card status-list" aria-label="안내">
        <div className="status-item">
          <div className="status-head">
            <IconPin color="#FFB224" />
            <strong>위치·모션 권한</strong>
          </div>
          <span className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
            주행 시작을 누르면 위치와 모션 센서 권한을 물어봐요. {isIos() ? '아이폰은 두 창 모두 "허용"을 눌러 주세요.' : '"허용"을 눌러 주세요.'}
          </span>
        </div>
        <div className="status-item">
          <div className="status-head">
            <IconPhone color="#FFB224" />
            <strong>홈 화면에 추가</strong>
            {standalone() && <span style={{ color: '#3EE08F' }}>홈 화면 앱으로 실행 중</span>}
          </div>
          <span className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
            {isIos() ? '사파리 공유 버튼 → "홈 화면에 추가"' : '크롬 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"'}. 앱처럼 열리고, 오래 안 써도
            기록이 지워지지 않아요.
          </span>
        </div>
        <div className="status-item">
          <label className="status-head" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 22, height: 22, accentColor: '#FFB224' }} />
            <strong style={{ fontSize: 14, lineHeight: 1.5 }}>공도에서는 교통법규를 지키고, 주행 중에는 앱을 조작하지 않겠습니다.</strong>
          </label>
        </div>
      </section>

      {acc.error && (
        <div className="notice warn">
          <IconWarn size={20} />
          {acc.error}
        </div>
      )}
      <div style={{ flex: 1 }} />
      <button type="button" className="primary-btn record" disabled={!ok} onClick={() => void finishOnboarding(name)}>
        {acc.busy ? '계정을 만드는 중…' : '시작하기'}
      </button>
    </main>
  );
}
