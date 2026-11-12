// 주행 준비 · 앞 친구 간격 (사용자 요청, M9): 앞 친구를 고르고 목표 간격(1초 이상)을 정한다.
// 처음 켤 때 안전 안내를 한 번 보여준다. 앞 친구가 위치 공유를 켜고 주행해야 간격이 보인다.
import { useEffect, useState } from 'react';
import { useAccount } from '../../app/account';
import { loadFriends, useFriends, type Friend } from '../../app/friends';
import { GAP_MAX_S, GAP_MIN_S, updateSettings, useSettings } from '../../app/settings';
import { Overlay } from './Overlay';

const ACK_KEY = 'gachitayo.gapSafetyAck';
const acked = () => {
  try {
    return localStorage.getItem(ACK_KEY) === '1';
  } catch {
    return false;
  }
};

export function GapSection() {
  const s = useSettings();
  const fr = useFriends();
  const acc = useAccount();
  const [ask, setAsk] = useState<Friend | null>(null);

  useEffect(() => {
    if (acc.status === 'ready') void loadFriends();
  }, [acc.status]);

  const chosen = fr.friends.find((f) => f.userId === s.gap.friendId) ?? null;
  // 친구를 끊었으면 고른 앞 친구도 지운다
  useEffect(() => {
    if (fr.loaded && s.gap.friendId && !chosen) updateSettings({ gap: { ...s.gap, friendId: null, nickname: null } });
  }, [fr.loaded, chosen, s.gap]);

  if (acc.status !== 'ready' || fr.friends.length === 0) return null;

  const pick = (f: Friend | null) => {
    if (f && !acked()) {
      setAsk(f);
      return;
    }
    updateSettings({ gap: { ...s.gap, friendId: f?.userId ?? null, nickname: f?.nickname ?? null } });
  };
  const step = (d: number) => updateSettings({ gap: { ...s.gap, targetS: Math.min(GAP_MAX_S, Math.max(GAP_MIN_S, s.gap.targetS + d)) } });
  const confirm = () => {
    try {
      localStorage.setItem(ACK_KEY, '1');
    } catch {
      // 저장할 수 없으면 다음에 다시 묻는다
    }
    const f = ask!;
    setAsk(null);
    updateSettings({ gap: { ...s.gap, friendId: f.userId, nickname: f.nickname } });
  };

  return (
    <section aria-label="앞 친구 간격" className="card card-col" style={{ gap: 10 }}>
      <span className="label">앞 친구 간격 (선택) · 델타 자리에 목표와의 차이</span>
      <div className="chip-row" role="group" aria-label="앞 친구">
        <button type="button" className="chip" aria-pressed={!chosen} onClick={() => pick(null)}>
          끄기
        </button>
        {fr.friends.map((f) => (
          <button key={f.userId} type="button" className="chip" aria-pressed={chosen?.userId === f.userId} onClick={() => pick(f)}>
            {f.sharing && <span className="dot" aria-hidden="true" />}
            {f.nickname}
          </button>
        ))}
      </div>
      {chosen && (
        <>
          <div className="stepper" role="group" aria-label="목표 간격">
            <button type="button" aria-label="목표 간격 줄이기" disabled={s.gap.targetS <= GAP_MIN_S} onClick={() => step(-0.5)}>
              −
            </button>
            <span className="mono">목표 {s.gap.targetS.toFixed(1)}초</span>
            <button type="button" aria-label="목표 간격 늘리기" disabled={s.gap.targetS >= GAP_MAX_S} onClick={() => step(0.5)}>
              +
            </button>
          </div>
          <span className="sub">
            {chosen.sharing ? `${chosen.nickname} 님이 위치를 공유하는 중이에요.` : `${chosen.nickname} 님이 메인 지도에서 위치 공유를 켜고 주행해야 간격이 보여요.`} 목표보다
            가까우면 빨강, 멀면 초록으로 보여요.
          </span>
        </>
      )}
      {ask && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="gap-safety-title">
              <h2 id="gap-safety-title">앞 친구 간격 안전 안내</h2>
              <p>
                간격은 참고용이에요. 주행 중에는 화면 대신 도로를 보세요. 공도에서는 교통법규와 안전거리를 지키세요. 목표 간격은 {GAP_MIN_S}초 이상만 정할 수
                있어요.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-primary" onClick={confirm}>
                  확인하고 켜기
                </button>
                <button type="button" className="btn" onClick={() => setAsk(null)}>
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
