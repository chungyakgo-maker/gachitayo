// 설정 · 친구 (사양서 8.8, M8): 내 친구 코드(복사), 카톡으로 친구 초대(사용자 결정 A-가, 설계 2026-11-18 team-drive),
// 친구 코드로 친구 추가, 친구 목록(프사, 공유 중 표시, 끊기)
import { useEffect, useState } from 'react';
import { useAccount } from '../../app/account';
import { addFriendByCode, formatCode, loadFriends, removeFriend, useFriends } from '../../app/friends';
import { kakaoShareReady, shareFriendInvite } from '../../app/kakaoShare';
import { Avatar } from './Avatar';

export function FriendsSection() {
  const fr = useFriends();
  const acc = useAccount();
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (acc.status === 'ready') void loadFriends();
  }, [acc.status]);

  if (acc.status !== 'ready') {
    return (
      <section className="card card-col" style={{ gap: 6 }} aria-label="친구">
        <strong>친구</strong>
        <span className="sub">친구 기능은 서버 계정이 있어야 해요. 통신이 연결되면 계정이 만들어져요.</span>
      </section>
    );
  }

  // 카톡 친구 초대: 받은 사람이 누르면 "○○님과 친구가 될까요?" → 바로 친구 (예전 "보내기"는 코드 글자만 보냈다)
  const invite = () => {
    if (!fr.code) return;
    void shareFriendInvite({ code: fr.code, nickname: acc.nickname ?? '친구' }).then((r) => {
      if (r === 'copied') setCopied(true);
    });
  };
  const copy = async () => {
    if (!fr.code) return;
    try {
      await navigator.clipboard.writeText(formatCode(fr.code));
      setCopied(true);
    } catch {
      // 복사할 수 없는 브라우저: 코드를 눌러 직접 고른다
    }
  };

  return (
    <section className="card card-col friends" style={{ gap: 10 }} aria-label="친구">
      <strong>친구</strong>
      <div className="friend-code-row">
        <span className="card-col" style={{ gap: 2 }}>
          <span className="label">내 친구 코드</span>
          <span className="mono friend-code" aria-label="내 친구 코드">
            {fr.code ? formatCode(fr.code) : '—'}
          </span>
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn small" disabled={!fr.code} onClick={() => void copy()}>
            {copied ? '복사됨' : '복사'}
          </button>
        </span>
      </div>
      <button type="button" className="kakao-btn" style={{ minHeight: 46 }} disabled={!fr.code} onClick={invite}>
        {kakaoShareReady() ? '카카오톡으로 친구 초대' : '친구 초대 보내기'}
      </button>
      <span className="sub">받은 사람이 누르면 바로 서로 친구가 돼요</span>
      <label htmlFor="friend-code-input" className="label">
        친구 코드 넣기
      </label>
      <form
        className="name-row"
        onSubmit={(e) => {
          e.preventDefault();
          void addFriendByCode(code).then((ok) => ok && setCode(''));
        }}
      >
        <input
          id="friend-code-input"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="예: K7P2-Q9XM"
          value={code}
          maxLength={11}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" disabled={fr.busy || code.trim().length < 8}>
          추가
        </button>
      </form>
      {fr.notice && <div className="notice">{fr.notice}</div>}
      {fr.error && <div className="notice warn">{fr.error}</div>}
      {fr.loaded && fr.friends.length === 0 && <span className="sub">아직 친구가 없어요. 내 코드를 보내거나 친구 코드를 넣어 주세요.</span>}
      {fr.friends.length > 0 && (
        <ul className="friend-list" aria-label="친구 목록">
          {fr.friends.map((f) => (
            <li key={f.userId}>
              <Avatar id={f.avatar} name={f.nickname} />
              <span className="card-col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                <span className="friend-name">{f.nickname}</span>
                <span className={`sub${f.sharing ? ' sharing' : ''}`}>{f.sharing ? '위치 공유 중' : '공유 안 함'}</span>
              </span>
              {confirm === f.userId ? (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn small danger" disabled={fr.busy} onClick={() => void removeFriend(f.userId).then(() => setConfirm(null))}>
                    끊기
                  </button>
                  <button type="button" className="btn small" onClick={() => setConfirm(null)}>
                    취소
                  </button>
                </span>
              ) : (
                <button type="button" className="btn small" aria-label={`${f.nickname} 친구 끊기`} onClick={() => setConfirm(f.userId)}>
                  끊기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <span className="sub" style={{ lineHeight: 1.6 }}>
        친구 코드를 넣으면 바로 서로 친구가 돼요. 위치는 메인 지도에서 "위치 공유"를 켠 동안만 친구에게 보여요.
      </span>
    </section>
  );
}
