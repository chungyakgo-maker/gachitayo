// 카톡 친구 초대 링크 #/friend/{코드}/{이름} (사용자 결정 A-가 "카톡 초대는 친구 초대로", 시안 ⑥): 누르면 "○○님과 친구가 될까요?" → 바로 서로 친구
import { useState } from 'react';
import { useAccount } from '../../app/account';
import { addFriendByCode, useFriends } from '../../app/friends';
import { IconBack } from '../icons';

export function FriendInviteScreen({ code, name }: { code: string; name: string }) {
  const acc = useAccount();
  const fr = useFriends();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const who = name.trim() || '친구';
  const accept = () => {
    setBusy(true);
    void addFriendByCode(code).then((ok) => {
      setBusy(false);
      if (ok) setDone(true);
    });
  };
  return (
    <main className="page">
      <header className="page-head">
        <a className="back-btn" href="#/" aria-label="메인으로">
          <IconBack size={24} />
        </a>
        <h1 style={{ flex: 1 }}>친구 초대</h1>
      </header>
      <section className="card card-col" style={{ gap: 12 }}>
        <strong style={{ fontSize: 18 }}>{who}님이 친구 초대를 보냈어요</strong>
        <span className="sub">친구가 되면 같은 팀으로 팀 주행을 할 수 있어요</span>
        {acc.status !== 'ready' && <span className="notice warn">계정이 있어야 친구가 될 수 있어요. 통신을 확인하고 앱을 다시 열어 주세요</span>}
        {done ? (
          <>
            <span className="notice" role="status">
              {who}님과 친구가 됐어요
            </span>
            <a className="primary-btn" href="#/settings" style={{ textDecoration: 'none' }}>
              친구 목록 보기
            </a>
          </>
        ) : (
          <button type="button" className="primary-btn" disabled={busy || acc.status !== 'ready'} onClick={accept}>
            친구 되기
          </button>
        )}
        {fr.error && !done && (
          <span className="notice warn" role="alert">
            {fr.error}
          </span>
        )}
        <a className="ghost-btn" href="#/" style={{ textAlign: 'center', textDecoration: 'none' }}>
          나중에
        </a>
      </section>
    </main>
  );
}
