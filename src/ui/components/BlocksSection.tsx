// 설정 › 안 보는 사람 (모두의 코스 설계 2부, 애플 심사 1.2 "차단"): "이 사람 코스 안 보기"로 고른 사람. 있을 때만 보인다
import { useEffect, useState } from 'react';
import { useAccount } from '../../app/account';
import { listBlocks, unblockUser } from '../../app/sharedCourses';

export function BlocksSection() {
  const acc = useAccount();
  const [list, setList] = useState<Array<{ userId: string; nickname: string }>>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (acc.status !== 'ready') return;
    let alive = true;
    listBlocks().then(
      (l) => alive && setList(l),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [acc.status]);
  if (list.length === 0) return null;
  return (
    <section className="card-col" style={{ gap: 8 }} aria-label="안 보는 사람">
      <span className="label">안 보는 사람 · 모두의 코스</span>
      {list.map((b) => (
        <div key={b.userId} className="card-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>{b.nickname}</span>
          <button
            type="button"
            className="btn small"
            aria-label={`${b.nickname} 풀기`}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void unblockUser(b.userId)
                .then(() => setList((l) => l.filter((x) => x.userId !== b.userId)))
                .catch(() => {})
                .finally(() => setBusy(false));
            }}
          >
            풀기
          </button>
        </div>
      ))}
    </section>
  );
}

/** 계정 번호 복사 (관리자 등록 때 쓴다): 앞 8자리만 보이고 누르면 전체를 복사한다 */
export function AccountIdCopy({ userId }: { userId: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="link-btn"
      aria-label="계정 번호 복사"
      onClick={() => {
        void navigator.clipboard?.writeText(userId).then(
          () => setDone(true),
          () => {},
        );
      }}
    >
      {`계정 번호 ${userId.slice(0, 8)}… ${done ? '복사했어요' : '복사'}`}
    </button>
  );
}
