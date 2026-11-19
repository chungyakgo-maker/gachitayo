// 내 코스 › 모두에게 공개 (설계 2부, 시안 ⑥): 한 번 달려 선이 있는 내 코스만. 공개 창에서 지역(출발점으로 짐작, 바꿀 수 있음)·경고·
// 법규 체크를 거쳐 공개. 공개 중이면 받은 수, 선·이름을 고친 뒤 "공개 코스도 고친 선으로 바꾸기", "공개 내리기"
import { useEffect, useState } from 'react';
import { signedIn, useAccount } from '../../app/account';
import { fetchSharedDetail, publishCourse, unpublish, updatePublished } from '../../app/sharedCourses';
import { guessSido, SIDOS, type Sido } from '../../courses/sidos';
import type { Course } from '../../types/course';
import { formatLength } from '../format';
import { Overlay } from './Overlay';

export function PublishSection({ course }: { course: Course }) {
  const acc = useAccount();
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const [region, setRegion] = useState<Sido | ''>(() => guessSido(course.startGate.lat, course.startGate.lon));
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [adds, setAdds] = useState<number | null>(null);
  useEffect(() => {
    if (!course.publishedId) return;
    let alive = true;
    fetchSharedDetail(course.publishedId).then(
      (d) => alive && setAdds(d.adds),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [course.publishedId]);
  if (course.builtin || course.shared || !course.centerline) return null;
  const run = (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    void work()
      .then(() => setMsg({ text: done }))
      .catch((e: Error) => setMsg({ text: e.message, warn: true }))
      .finally(() => {
        setBusy(false);
        setOpen(false);
        setAsk(false);
      });
  };
  const changed = course.publishedId && (course.publishedVersion !== course.version || course.publishedName !== course.name);
  return (
    <section className="card-col" style={{ gap: 8 }} aria-label="모두의 코스 공개">
      {course.publishedId ? (
        <>
          <span className="label">{adds === null ? '공개 중' : `공개 중 · ${adds}명 받음`}</span>
          <div className="button-pair">
            <button type="button" className="btn" disabled={busy || !changed} onClick={() => run(() => updatePublished(course.id), '공개 코스도 바꿨어요')}>
              공개 코스도 고친 선으로 바꾸기
            </button>
            <button type="button" className="btn danger" disabled={busy} onClick={() => setAsk(true)}>
              공개 내리기
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setMsg(null);
            if (!signedIn(acc)) setMsg({ text: '공개하려면 카카오나 Apple로 로그인해 주세요', warn: true });
            else {
              setOk(false);
              setOpen(true);
            }
          }}
        >
          모두에게 공개
        </button>
      )}
      {msg && (
        <div className={`notice${msg.warn ? ' warn' : ''}`} role="status">
          {msg.text}
        </div>
      )}
      {open && (
        <Overlay>
          <div className="sheet-backdrop" onClick={() => !busy && setOpen(false)}>
            <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="publish-title" onClick={(e) => e.stopPropagation()}>
              <h2 id="publish-title">모두에게 공개할까요?</h2>
              <strong style={{ fontSize: 18 }}>{course.name}</strong>
              <span className="sub">{`${course.kind === 'loop' ? '랩' : '편도'} · ${formatLength(course.lengthM)}`}</span>
              <label className="label" htmlFor="publish-region">
                지역
              </label>
              <select id="publish-region" aria-label="지역" value={region} onChange={(e) => setRegion(e.target.value as Sido | '')}>
                {SIDOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                <option value="">정하지 않음</option>
              </select>
              <div className="notice caution">코스 선·이름·내 닉네임이 모두에게 보여요. 출발·도착이 집이나 회사 근처면 공개하지 마세요.</div>
              <span className="sub">기록(랩 시간)은 올라가지 않아요. 언제든 공개를 내릴 수 있어요.</span>
              <label className="check-row">
                <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
                일반 도로 법규를 지키며 달릴 수 있는 길이에요
              </label>
              <button type="button" className="primary-btn" disabled={!ok || busy} onClick={() => run(() => publishCourse(course.id, region), '모두의 코스에 공개했어요')}>
                공개하기
              </button>
              <button type="button" className="ghost-btn" disabled={busy} onClick={() => setOpen(false)}>
                취소
              </button>
            </div>
          </div>
        </Overlay>
      )}
      {ask && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unpublish-title">
              <h2 id="unpublish-title">공개를 내릴까요?</h2>
              <p>모두의 코스에서 사라져요. 이미 받아 간 사람의 폰에 있는 코스는 그대로예요.</p>
              <div className="modal-actions">
                <button type="button" className="btn danger" disabled={busy} onClick={() => run(() => unpublish(course.id), '공개를 내렸어요')}>
                  내리기
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setAsk(false)}>
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
