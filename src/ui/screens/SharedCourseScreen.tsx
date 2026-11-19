// 모두의 코스 상세 (#/shared/{id}, 설계 2부, 시안 ⑧): 지도·정보, "이 코스로 주행"(받고 바로 주행 준비), "내 코스에 담기",
// 출발점으로 길찾기, 작게 "신고"·"이 사람 코스 안 보기"(애플 심사 1.2). 내가 올린 코스면 "공개 내리기", 신고로 숨겨졌으면 안내
import { useEffect, useMemo, useState } from 'react';
import { signedIn, useAccount } from '../../app/account';
import { beginPrepare, chooseCourse } from '../../app/drive';
import { handOffDestination } from '../../app/routeNav';
import { addSharedToPhone, blockUser, fetchSharedDetail, REPORT_REASONS, reportShared, sharedOnPhone, unpublishById, type ReportReason } from '../../app/sharedCourses';
import { courseFromShared } from '../../engine/course/share';
import type { Course } from '../../types/course';
import type { SharedDetail } from '../../types/shared';
import { Overlay } from '../components/Overlay';
import { PickMap } from '../components/PickMap';
import { sharedLine } from '../components/SharedCourseList';
import { IconBack } from '../icons';
import { courseShapes } from './CourseDetailScreen';

export function SharedCourseScreen({ id }: { id: string }) {
  const acc = useAccount();
  const [d, setD] = useState<SharedDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [have, setHave] = useState<Course | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [ask, setAsk] = useState<'report' | 'block' | 'unpublish' | null>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    let alive = true;
    fetchSharedDetail(id).then(
      (x) => alive && setD(x),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    void sharedOnPhone(id).then((c) => alive && setHave(c));
    return () => {
      alive = false;
    };
  }, [id]);
  const preview = useMemo(() => (d ? courseFromShared(d, `preview-${d.id}`) : null), [d]);
  const map = useMemo(() => (preview ? courseShapes(preview, null) : { shapes: [], fit: [] }), [preview]);

  if (error || !d || !preview) {
    return (
      <main className="page page-full">
        <header className="page-head">
          <a className="back-btn" href="#/courses" aria-label="코스로">
            <IconBack size={24} />
          </a>
          <h1>모두의 코스</h1>
        </header>
        {error ? <div className="notice warn">{error}</div> : <span className="sub">불러오는 중…</span>}
      </main>
    );
  }

  const fail = (e: unknown) => setMsg({ text: e instanceof Error ? e.message : String(e), warn: true });
  // 아이폰 모션 권한은 탭 처리 안에서 물어야 하므로 주행 준비를 먼저 열고, 받은 코스를 고른다
  const drive = () => {
    beginPrepare();
    void addSharedToPhone(d.id, d)
      .then((c) => chooseCourse(c))
      .catch(fail);
  };
  const add = () => {
    setBusy(true);
    setMsg(null);
    void addSharedToPhone(d.id, d)
      .then((c) => setHave(c))
      .catch(fail)
      .finally(() => setBusy(false));
  };
  const doReport = () => {
    if (!reason) return;
    setBusy(true);
    void reportShared(d.id, reason, note)
      .then(() => setMsg({ text: '신고했어요. 3명이 신고하면 바로 숨겨지고 운영자가 확인해요' }))
      .catch(fail)
      .finally(() => {
        setBusy(false);
        setAsk(null);
      });
  };
  const doBlock = () => {
    setBusy(true);
    void blockUser(d.byId)
      .then(() => {
        window.location.hash = '#/courses';
      })
      .catch(fail)
      .finally(() => {
        setBusy(false);
        setAsk(null);
      });
  };
  const doUnpublish = () => {
    setBusy(true);
    void unpublishById(d.id)
      .then(() => {
        window.location.hash = '#/courses';
      })
      .catch(fail)
      .finally(() => {
        setBusy(false);
        setAsk(null);
      });
  };

  return (
    <main className="page page-full">
      <header className="page-head">
        <a className="back-btn" href="#/courses" aria-label="코스로">
          <IconBack size={24} />
        </a>
        <h1 style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</h1>
      </header>
      <span className="sub" style={{ marginTop: -8 }}>{`${sharedLine(d)} · 올린 사람 ${d.by} · ${d.adds}명 받음`}</span>
      {d.status === 'hidden' && <div className="notice warn">신고로 숨겨졌어요. 운영자가 확인하고 있어요</div>}
      <PickMap shapes={map.shapes} fit={map.fit} fitKey={d.id} label="모두의 코스 지도: 중심선, 출발선, 도착선" onPick={() => {}} />
      <button type="button" className="primary-btn" disabled={busy} onClick={drive}>
        이 코스로 주행
      </button>
      {have ? (
        <a className="btn" href={`#/course/${encodeURIComponent(have.id)}`} style={{ textAlign: 'center', textDecoration: 'none' }}>
          내 코스에 있어요 ›
        </a>
      ) : (
        <button type="button" className="btn" disabled={busy} onClick={add}>
          내 코스에 담기
        </button>
      )}
      <button
        type="button"
        className="btn"
        onClick={() => {
          handOffDestination({ lat: d.startGate.lat, lon: d.startGate.lon, name: `${d.name} · 출발점`, kind: 'course-start' });
          window.location.hash = '#/destination';
        }}
      >
        출발점으로 길찾기
      </button>
      {msg && (
        <div className={`notice${msg.warn ? ' warn' : ''}`} role="status">
          {msg.text}
        </div>
      )}
      {d.mine ? (
        <button type="button" className="btn danger" disabled={busy} onClick={() => setAsk('unpublish')}>
          공개 내리기
        </button>
      ) : (
        <div className="shared-actions">
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setMsg(null);
              if (!signedIn(acc)) setMsg({ text: '신고하려면 카카오나 Apple로 로그인해 주세요', warn: true });
              else {
                setReason(null);
                setNote('');
                setAsk('report');
              }
            }}
          >
            신고
          </button>
          <button type="button" className="link-btn" onClick={() => setAsk('block')}>
            이 사람 코스 안 보기
          </button>
        </div>
      )}
      {ask === 'report' && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
              <h2 id="report-title">이 코스를 신고할까요?</h2>
              <div className="card-col" role="radiogroup" aria-label="신고 이유" style={{ gap: 4 }}>
                {REPORT_REASONS.map((r) => (
                  <label key={r.id} className="check-row">
                    <input type="radio" name="report-reason" checked={reason === r.id} onChange={() => setReason(r.id)} />
                    {r.label}
                  </label>
                ))}
              </div>
              {reason === 'other' && <input type="text" aria-label="기타 이유" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} placeholder="한 줄로 적어 주세요" />}
              <div className="modal-actions">
                <button type="button" className="btn danger" disabled={busy || !reason} onClick={doReport}>
                  신고하기
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setAsk(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}
      {ask === 'block' && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="block-title">
              <h2 id="block-title">{`${d.by} 님의 코스를 안 볼까요?`}</h2>
              <p>모두의 코스 목록에서 이 사람이 올린 코스가 모두 빠져요. 설정 › 안 보는 사람에서 풀 수 있어요.</p>
              <div className="modal-actions">
                <button type="button" className="btn danger" disabled={busy} onClick={doBlock}>
                  안 보기
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setAsk(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}
      {ask === 'unpublish' && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unpub-title">
              <h2 id="unpub-title">공개를 내릴까요?</h2>
              <p>모두의 코스에서 사라져요. 이미 받아 간 사람의 폰에 있는 코스는 그대로예요.</p>
              <div className="modal-actions">
                <button type="button" className="btn danger" disabled={busy} onClick={doUnpublish}>
                  내리기
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
