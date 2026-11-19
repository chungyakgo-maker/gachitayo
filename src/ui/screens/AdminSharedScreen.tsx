// 관리자 · 모두의 코스 관리 (#/admin/shared, 설계 2부 "관리자인 내가 삭제할 수 있게"): 신고·숨김이 먼저(서버 순서).
// 숨기기·숨김 풀기·지우기(되돌릴 수 없음, 받은 사람 폰의 코스는 남음)·이 계정 공개 막기. 관리자 아니면 서버가 403 이라 안내만
import { useEffect, useState } from 'react';
import { useAccount } from '../../app/account';
import { adminBan, adminDelete, adminList, adminSet, REPORT_REASONS, type AdminRow } from '../../app/sharedCourses';
import { Overlay } from '../components/Overlay';
import { sharedLine } from '../components/SharedCourseList';
import { IconBack } from '../icons';

const reasonText = (r: AdminRow['reasons']) =>
  REPORT_REASONS.filter((x) => r[x.id])
    .map((x) => `${x.label} ${r[x.id]}`)
    .join(' · ');

export function AdminSharedScreen() {
  const acc = useAccount();
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ kind: 'delete' | 'ban'; row: AdminRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    adminList().then(
      (r) => setRows(r),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  useEffect(() => {
    if (acc.admin) void load();
  }, [acc.admin]);
  const act = (work: () => Promise<void>) => {
    setBusy(true);
    void work()
      .then(load)
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        setAsk(null);
      });
  };
  return (
    <main className="page page-full">
      <header className="page-head">
        <a className="back-btn" href="#/settings" aria-label="설정으로">
          <IconBack size={24} />
        </a>
        <h1>모두의 코스 관리</h1>
      </header>
      {!acc.admin ? (
        <div className="notice">관리자만 볼 수 있어요</div>
      ) : (
        <>
          {error && <div className="notice warn">{error}</div>}
          {!rows ? (
            <span className="sub">불러오는 중…</span>
          ) : rows.length === 0 ? (
            <span className="sub">공개된 코스가 없어요</span>
          ) : (
            <ul className="rows">
              {rows.map((r) => (
                <li key={r.id} className="card card-col" style={{ gap: 6 }}>
                  <a href={`#/shared/${encodeURIComponent(r.id)}`} style={{ color: 'inherit' }}>
                    <strong>{r.name}</strong>
                  </a>
                  <span className="sub">{`${sharedLine(r)} · 올린 사람 ${r.by} · ${r.adds}명 받음`}</span>
                  <span className={r.status === 'hidden' || r.reports ? 'warn-text' : 'sub'}>
                    {[r.status === 'hidden' ? '숨김' : '공개 중', r.reports ? `신고 ${r.reports}${reasonText(r.reasons) ? ` (${reasonText(r.reasons)})` : ''}` : ''].filter(Boolean).join(' · ')}
                  </span>
                  <div className="button-pair">
                    <button type="button" className="btn small" disabled={busy} onClick={() => act(() => adminSet(r.id, r.status === 'hidden' ? 'show' : 'hide'))}>
                      {r.status === 'hidden' ? '숨김 풀기' : '숨기기'}
                    </button>
                    <button type="button" className="btn small danger" disabled={busy} onClick={() => setAsk({ kind: 'delete', row: r })}>
                      지우기
                    </button>
                  </div>
                  <button type="button" className="link-btn" disabled={busy} onClick={() => setAsk({ kind: 'ban', row: r })}>
                    이 계정 공개 막기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {ask && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="admin-ask-title">
              <h2 id="admin-ask-title">{ask.kind === 'delete' ? `"${ask.row.name}"을 지울까요?` : `${ask.row.by} 님의 공개를 막을까요?`}</h2>
              <p>{ask.kind === 'delete' ? '되돌릴 수 없어요. 이미 받아 간 사람의 폰에 있는 코스는 남아요.' : '이 사람의 공개 코스를 모두 숨기고, 새로 공개하지 못하게 해요.'}</p>
              <div className="modal-actions">
                <button type="button" className="btn danger" disabled={busy} onClick={() => act(() => (ask.kind === 'delete' ? adminDelete(ask.row.id) : adminBan(ask.row.byId)))}>
                  {ask.kind === 'delete' ? '지우기' : '막기'}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setAsk(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}
    </main>
  );
}
