// 카톡 초대 링크 #/join/{코드} (사용자 요청 "방코드를 카톡으로 공유하기"): 계정이 준비되면 바로 그 방으로 들어간다.
// 다른 방에 들어가 있으면 묻는다
import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../../app/account';
import { groupErrorText, joinGroupRoom, leaveGroupRoom, useGroup } from '../../app/group';
import { formatRoomCode } from '../../app/kakaoShare';
import { IconBack } from '../icons';
import { takePendingJoin } from '../../app/pendingJoin';

export function JoinScreen({ code }: { code: string }) {
  const acc = useAccount();
  const g = useGroup();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);
  const valid = /^\d{6}$/.test(code);
  const other = g.room && g.room.code !== code ? g.room : null;
  const join = () => {
    setBusy(true);
    setError(null);
    joinGroupRoom(code).then(
      () => {
        window.location.hash = '#/group';
      },
      (e: unknown) => {
        setError(groupErrorText(e));
        setBusy(false);
      },
    );
  };
  // 이 화면이 열렸으면 들고 있던 초대는 다 썼다 (메인으로 돌아갈 때 다시 끌려오지 않게)
  useEffect(() => void takePendingJoin(), []);
  useEffect(() => {
    if (g.room?.code === code) {
      window.location.hash = '#/group';
      return;
    }
    if (!valid || acc.status !== 'ready' || other || tried.current) return;
    tried.current = true;
    join();
    // join은 이 화면에서 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acc.status, g.room, code, valid]);

  return (
    <main className="page">
      <header className="page-head">
        <a className="back-btn" href="#/" aria-label="메인으로">
          <IconBack size={24} />
        </a>
        <h1 style={{ flex: 1 }}>그룹 주행 초대</h1>
      </header>
      <section className="card card-col" style={{ gap: 8 }}>
        <span className="label">방 코드</span>
        <div className="group-code">{valid ? formatRoomCode(code) : '—'}</div>
        {!valid && <span className="notice warn">초대 링크가 잘못됐어요. 방 코드를 다시 받아 주세요</span>}
        {valid && acc.status !== 'ready' && <span className="sub">계정을 준비하는 중… 통신이 안 되면 잠시 뒤 다시 열어 주세요</span>}
        {valid && busy && <span className="sub" role="status">방에 들어가는 중…</span>}
        {error && (
          <span className="notice warn" role="alert">
            {error}
          </span>
        )}
        {valid && error && (
          <button type="button" className="primary-btn" disabled={busy} onClick={join}>
            다시 시도
          </button>
        )}
      </section>
      {valid && other && (
        <section className="card card-col" style={{ gap: 8 }}>
          <strong>다른 방({formatRoomCode(other.code)})에 들어가 있어요</strong>
          <span className="sub">지금 방에서 나가고 이 방으로 들어갈까요?</span>
          <button
            type="button"
            className="primary-btn"
            disabled={busy}
            onClick={() => {
              // 나간 뒤 화면이 저절로 한 번 더 들어가지 않게 (검토 지적: 두 번 들어갔다)
              tried.current = true;
              setBusy(true);
              void leaveGroupRoom().then(join);
            }}
          >
            나가고 이 방으로
          </button>
          <a className="ghost-btn" href="#/group" style={{ textDecoration: 'none', textAlign: 'center' }}>
            지금 방으로
          </a>
        </section>
      )}
    </main>
  );
}
