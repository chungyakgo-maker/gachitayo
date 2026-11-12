// 주행 종료 요약 (사양서 8.5, 디자인 시안 Summary)
import { useEffect, useState } from 'react';
import { changeKind, processSession, saveCourse, useProcessing } from '../../app/drive';
import { getDriveRepo, getRepo } from '../../app/recording';
import { useSync } from '../../app/sync';
import type { InvalidReason } from '../../engine/course/laps';
import type { Course, CourseKind } from '../../types/course';
import type { DriveResultRecord } from '../../types/drive';
import type { SessionRecord } from '../../types/session';
import { CourseMap } from '../components/CourseMap';
import { formatDayKst, formatDelta, formatLapTime, formatLength } from '../format';
import { IconCloud } from '../icons';

const REASON: Record<InvalidReason, string> = {
  coverage: '코스를 다 돌지 않음',
  distance: '거리 불일치',
  gps_lost: 'GPS 끊김',
  off_course: '코스 이탈',
  interrupted: '앱 중단',
};

interface Loaded {
  session: SessionRecord;
  result: DriveResultRecord | null;
  course: Course | null;
}

export function SummaryView({
  data,
  busy,
  error,
  onRetry,
  onKind,
  onSave,
  upload = '폰에 저장됨',
}: {
  data: Loaded;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onKind: (k: CourseKind) => void;
  onSave: (name: string) => void;
  /** 업로드 상태 한 줄 */
  upload?: string;
}) {
  const { session, result, course } = data;
  const [name, setName] = useState('');
  const [tried, setTried] = useState<CourseKind | null>(null);
  const laps = result?.laps ?? [];
  const valid = laps.filter((l) => l.valid);
  const best = laps.find((l) => l.lapNo === result?.bestLapNo) ?? null;
  const proposed = result?.proposedCourse ?? null;
  const unsaved = result !== null && !result.courseId;
  const shownCourse = course ?? proposed;
  const kind = proposed?.kind ?? tried;

  return (
    <main className="page page-full">
      <header className="card-col" style={{ gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>주행 종료</h1>
        <span style={{ fontSize: 13 }} className="dim">
          {formatDayKst(session.startedAt)} · {course?.name ?? (proposed ? '새 코스' : '코스 없음')}
          {result ? ` · ${laps.length}랩` : ''}
        </span>
      </header>

      {busy && (
        <div className="card card-col" role="status">
          <strong>주행 기록을 계산하는 중…</strong>
          <span className="sub">폰에 저장된 원본 전체로 위치를 다시 다듬고 랩을 확정합니다.</span>
          <div className="progress">
            <div style={{ width: '60%', animation: 'none' }} />
          </div>
        </div>
      )}
      {error && !busy && (
        <div className="notice warn" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span>계산하지 못했습니다: {error}</span>
          <button type="button" className="btn" onClick={onRetry}>
            다시 계산
          </button>
        </div>
      )}

      {result && !busy && unsaved && (
        <section aria-label="새 코스 저장" className="newcourse">
          <div className="card-col">
            <h2>새 코스로 저장할까요?</h2>
            <span style={{ fontSize: 13 }} className="dim">
              {!proposed
                ? '이 종류로는 코스를 찾지 못했어요'
                : tried
                  ? `${kind === 'loop' ? '랩 코스' : '편도 구간'}로 다시 만들었어요`
                  : kind === 'loop'
                    ? '출발점으로 돌아와서 랩 코스로 감지했어요'
                    : '출발점으로 돌아오지 않아 편도 구간으로 감지했어요'}
            </span>
          </div>
          <div className="segmented small on-bg" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            {(['loop', 'point_to_point'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => {
                  if (kind === k) return;
                  setTried(k);
                  onKind(k);
                }}
              >
                {k === 'loop' ? '랩 코스' : '편도 구간'}
              </button>
            ))}
          </div>
          {proposed && (
            <>
              <div className="mini-map" style={{ position: 'relative' }}>
                <CourseMap variant="mini" course={proposed} label="새 코스 미리보기: 출발선과 도착선" />
              </div>
              <span className="sub">
                {proposed.kind === 'loop' ? '랩' : '편도'} · {formatLength(proposed.lengthM)}
              </span>
              <label htmlFor="courseName" className="label">
                코스 이름
              </label>
              <div className="name-row" style={{ marginTop: -6 }}>
                <input id="courseName" type="text" placeholder="예: 인제 풀코스" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
                <button type="button" onClick={() => onSave(name)}>
                  저장
                </button>
              </div>
            </>
          )}
          <span className="sub">저장하지 않으면 코스 없이 주행 기록만 남습니다.</span>
        </section>
      )}

      {result && !busy && !unsaved && best && (
        <section aria-label="베스트 랩" className="best-card">
          <span style={{ fontSize: 13 }} className="dim">
            베스트 랩 · 랩 {best.lapNo}
          </span>
          <span className="best-time">{formatLapTime(best.lapTimeMs, 3)}</span>
          {result.previousBestMs !== null && best.lapTimeMs < result.previousBestMs && (
            <span className="pill fast">
              개인 기록 갱신 <span className="mono">{formatDelta((best.lapTimeMs - result.previousBestMs) / 1000, 3)}</span>
            </span>
          )}
        </section>
      )}
      {result && !busy && !unsaved && !best && (
        <div className="notice">{laps.length ? '유효한 랩이 없어요.' : shownCourse ? '출발선을 지난 완주 랩이 없어요.' : '코스를 만들지 못했어요 (너무 짧거나 GPS가 부족).'}</div>
      )}

      {result && !busy && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span className="label">이론상 베스트</span>
              <span className="v">{formatLapTime(result.theoreticalBest.totalMs, 3)}</span>
            </div>
            <div className="stat">
              <span className="label">유효 랩</span>
              <span className="v">
                {valid.length} / {laps.length}
              </span>
            </div>
          </div>
          {laps.length > 0 && (
            <section aria-label="랩 기록" className="lap-table">
              <div className="lap-row head">
                <span>랩</span>
                <span>기록</span>
                <span>베스트 대비</span>
              </div>
              {laps.map((l) => {
                const isBest = best?.lapNo === l.lapNo;
                return (
                  <div key={l.lapNo} className={`lap-row${isBest ? ' best' : ''}${l.valid ? '' : ' invalid'}`}>
                    <span className="no">{l.lapNo}</span>
                    <span className="t">{formatLapTime(l.lapTimeMs, 3)}</span>
                    {isBest ? (
                      <span className="note">베스트</span>
                    ) : !l.valid ? (
                      <span className="note dim">무효 · {REASON[l.invalidReason!]}</span>
                    ) : (
                      <span className="vs">{best ? formatDelta((l.lapTimeMs - best.lapTimeMs) / 1000, 3) : '—'}</span>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {result.fusion.gpsOnly && <div className="notice">모션 센서 없이 GPS만으로 계산했어요 (정확도 낮음).</div>}
          <div className="notice">
            <IconCloud size={20} color={session.status === 'uploaded' ? '#3EE08F' : '#FFB224'} />
            {upload}
          </div>
        </>
      )}

      <div style={{ flex: 1 }} />
      <a className="primary-btn" href="#/">
        홈으로
      </a>
    </main>
  );
}

export function SummaryScreen({ sessionId }: { sessionId: string }) {
  const proc = useProcessing(sessionId);
  const sync = useSync();
  const [data, setData] = useState<Loaded | 'missing' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const session = await getRepo().get(sessionId);
      if (!alive) return;
      if (!session) {
        setData('missing');
        return;
      }
      const result = (await getDriveRepo().getResult(sessionId)) ?? null;
      const course = result?.courseId ? ((await getDriveRepo().getCourse(result.courseId)) ?? null) : null;
      if (!alive) return;
      setData({ session, result, course });
      // 아직 처리하지 않은 기록이면 처리한다 (기록 목록에서 연 경우 등)
      if (!result && !proc && session.status !== 'recording') void processSession(sessionId);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // 업로드가 끝나면 세션 상태(업로드됨)를 다시 읽는다
  }, [sessionId, proc?.state, sync.pending, sync.lastSyncAt]);

  if (data === 'missing') {
    return (
      <main className="page page-full">
        <div className="empty">기록을 찾을 수 없습니다.</div>
        <a className="primary-btn" href="#/">
          홈으로
        </a>
      </main>
    );
  }
  if (!data) return <main className="page page-full" aria-busy="true" />;
  const upload = !sync.enabled
    ? '폰에 저장됨 · 서버 연결 전'
    : data.session.status === 'uploaded'
      ? '업로드됨'
      : '업로드 대기 · 통신이 연결되면 자동으로 올라갑니다';
  return (
    <SummaryView
      data={data}
      upload={upload}
      busy={proc?.state === 'running'}
      error={saveError ?? (proc?.state === 'error' ? proc.error : null)}
      onRetry={() => {
        setSaveError(null);
        void processSession(sessionId);
      }}
      onKind={(k) => void changeKind(sessionId, k)}
      onSave={(name) => {
        void saveCourse(sessionId, name).then((ok) => setSaveError(ok ? null : '코스를 저장하지 못했습니다'));
      }}
    />
  );
}
