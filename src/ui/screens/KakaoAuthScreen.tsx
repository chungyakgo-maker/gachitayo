// 카카오에서 돌아온 화면 (#/auth/kakao?state&pin 또는 &error, 설계 5.2-4)
// - 이 창에서 시작한 로그인: 저절로 마치고 시작한 화면으로 돌아간다
// - 다른 창(아이폰 홈 화면 앱이 카카오를 다른 창에서 연 경우 등): 번호를 크게 보여 주고 원래 앱에 넣게 한다
import { useEffect, useMemo, useState } from 'react';
import { cancelKakaoLogin, finishedKakaoLogin, finishKakaoLogin, pendingKakaoLogin } from '../../app/kakaoLogin';
import { IconWarn } from '../icons';

function readQuery(): { state: string; pin: string; error: string } {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  return { state: q.get('state') ?? '', pin: q.get('pin') ?? '', error: q.get('error') ?? '' };
}

export function KakaoAuthScreen() {
  const q = useMemo(readQuery, []);
  // 이 창에서 시작한 로그인인지 (앱 시작 때 이미 마쳤을 수도 있다), 마친 뒤 돌아갈 화면
  const [{ mine, back }] = useState(() => {
    const p = pendingKakaoLogin();
    const done = finishedKakaoLogin(q.state);
    return { mine: p?.state === q.state || done !== null, back: (p?.state === q.state ? p.from : done?.from) ?? p?.from ?? '#/' };
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.error && mine) cancelKakaoLogin();
  }, [q.error, mine]);

  useEffect(() => {
    if (q.error || !mine || !/^\d{6}$/.test(q.pin)) return;
    let alive = true;
    void finishKakaoLogin(q.state, q.pin).then((r) => {
      if (!alive) return;
      // 번호가 든 주소는 기록에 남기지 않는다
      if (r.ok) window.location.replace(back);
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [q, mine, back]);

  const goBack = () => window.location.replace(back);

  if (q.error) {
    return (
      <main className="page page-full">
        <h1 style={{ margin: 0, fontSize: 22 }}>{q.error === 'cancelled' ? '카카오 로그인을 취소했어요' : '카카오 로그인에 실패했어요'}</h1>
        <div style={{ flex: 1 }} />
        <button type="button" className="primary-btn" onClick={goBack}>
          돌아가기
        </button>
      </main>
    );
  }

  if (!mine && /^\d{6}$/.test(q.pin)) {
    return (
      <main className="page page-full" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 18 }}>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6 }}>앱으로 돌아가서 이 번호를 입력해 주세요</p>
        <strong className="mono" style={{ fontSize: 46, letterSpacing: '0.12em' }}>
          {q.pin}
        </strong>
        <span className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
          다른 사람에게 알려 주지 마세요. 10분 동안만 쓸 수 있어요.
        </span>
        <span className="warn-text" style={{ fontSize: 13, lineHeight: 1.6 }}>
          이 앱에서 방금 로그인을 시작하지 않았다면 이 창을 닫으세요.
        </span>
      </main>
    );
  }

  if (mine && !error) {
    return (
      <main className="page page-full" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <p style={{ margin: 0, fontSize: 17 }}>카카오 로그인을 마치는 중…</p>
      </main>
    );
  }

  return (
    <main className="page page-full">
      <div className="notice warn">
        <IconWarn size={20} />
        {error ?? '잘못된 로그인 주소예요. 앱에서 다시 시도해 주세요'}
      </div>
      <div style={{ flex: 1 }} />
      <button type="button" className="primary-btn" onClick={goBack}>
        돌아가기
      </button>
    </main>
  );
}
