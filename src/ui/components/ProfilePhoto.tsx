// 설정 · 내 프로필 사진 (사용자 요청 "아주 작은 프사 동그랗게", "업로드 방식으로만", 프사 시안 ①):
// 폰 사진을 고르면 가운데를 동그랗게 잘라 작게(160px) 올린다. 친구·팀원에게만 보인다. 지우면 첫 글자 동그라미
import { useEffect, useState } from 'react';
import { useAccount } from '../../app/account';
import { loadMyAvatar, removeAvatar, uploadAvatar, useMyAvatar } from '../../app/avatar';
import { teamErrorText } from '../../app/teams';
import { Avatar } from './Avatar';

export function ProfilePhoto() {
  const acc = useAccount();
  const mine = useMyAvatar();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (acc.status === 'ready' && mine === undefined) void loadMyAvatar().catch(() => undefined);
  }, [acc.status, mine]);
  if (acc.status !== 'ready') return null;
  const run = (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    f().then(
      () => setBusy(false),
      (e: unknown) => {
        setError(teamErrorText(e));
        setBusy(false);
      },
    );
  };
  return (
    <div className="profile-photo">
      <Avatar id={mine} name={acc.nickname ?? '나'} size={76} />
      <span className="card-col" style={{ gap: 6, flex: 1 }}>
        <label className={`btn small${busy ? ' disabled' : ''}`} style={{ textAlign: 'center' }}>
          {busy ? '올리는 중…' : '사진 바꾸기'}
          <input
            type="file"
            accept="image/*"
            aria-label="사진 바꾸기"
            disabled={busy}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) run(() => uploadAvatar(f));
            }}
          />
        </label>
        {mine && (
          <button type="button" className="ghost-btn small" disabled={busy} onClick={() => run(removeAvatar)}>
            사진 지우기
          </button>
        )}
        <span className="sub">친구·팀원에게만 보여요</span>
      </span>
      {error && (
        <span className="notice warn" role="alert" style={{ flexBasis: '100%' }}>
          {error}
        </span>
      )}
    </div>
  );
}
