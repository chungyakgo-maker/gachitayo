// 카카오 로그인 진행 중 (설계 5.2-4): 다른 창에서 로그인을 마쳤으면 그 창에 보이는 6자리 번호를 여기에 넣는다
import { useState } from 'react';
import { cancelKakaoLogin, finishKakaoLogin, useKakaoPending } from '../../app/kakaoLogin';

export function KakaoPendingCard() {
  const pending = useKakaoPending();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!pending) return null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await finishKakaoLogin(pending.state, pin);
    setBusy(false);
    if (!r.ok) setError(r.error);
  };
  return (
    <section className="notice" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }} aria-label="카카오 로그인 진행 중">
      <span style={{ lineHeight: 1.6 }}>카카오 로그인을 마치는 중이에요. 다른 창에 6자리 번호가 보이면 입력해 주세요.</span>
      <div className="name-row">
        <input
          aria-label="6자리 번호"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <button type="button" disabled={pin.length !== 6 || busy} onClick={() => void submit()}>
          확인
        </button>
      </div>
      {error && <span style={{ color: 'var(--warn, #FF8A3D)' }}>{error}</span>}
      <button type="button" className="ghost-btn" onClick={cancelKakaoLogin}>
        로그인 취소
      </button>
    </section>
  );
}
