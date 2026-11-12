// 기록 탭: 최근 주행 목록 → 종료 요약 다시 보기 (분석 화면은 다음 단계).
// 기록 지우기 (M10, 사용자 요청): 휴지통 → 확인 창 → 폰과 서버에서 지운다.
import { useState } from 'react';
import { useRecording } from '../../app/recording';
import { deleteSessionRecord } from '../../app/sync';
import { Overlay } from '../components/Overlay';
import type { SessionStatus } from '../../types/session';
import { Tabbed } from '../components/TabBar';
import { formatDuration, formatKst, formatLapTime } from '../format';
import { IconChevron, IconTrash } from '../icons';

const STATUS: Record<SessionStatus, string> = {
  recording: '기록 중',
  interrupted: '중단됨',
  finished: '계산 전',
  processed: '',
  uploaded: '',
};

export function HistoryScreen() {
  const { sessions, sessionId } = useRecording();
  const list = sessions.filter((s) => s.id !== sessionId);
  const [ask, setAsk] = useState<{ id: string; when: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    if (!ask) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSessionRecord(ask.id);
      setAsk(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tabbed path="/history">
      <main className="page">
        <header className="page-head">
          <h1 className="big">기록</h1>
        </header>
        {list.length === 0 ? (
          <div className="empty">아직 주행 기록이 없어요.</div>
        ) : (
          <ul className="rows">
            {list.map((s) => {
              const sum = s.summary;
              return (
                <li key={s.id} className="row-with-action">
                  <a className="row-card" href={`#/summary/${s.id}`}>
                    <span className="card-col">
                      <strong style={{ fontSize: 15 }} className="mono">
                        {formatKst(s.startedAt)}
                      </strong>
                      <span className="sub">
                        {sum?.courseName ?? '코스 없음'}
                        {sum ? ` · ${sum.lapCount}랩` : ''}
                        {s.endedAt ? ` · ${formatDuration(s.endedAt - s.startedAt)}` : ''}
                        {STATUS[s.status] ? ` · ${STATUS[s.status]}` : ''}
                      </span>
                    </span>
                    <span className="right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="mono">{sum?.bestLapMs != null ? formatLapTime(sum.bestLapMs, 3) : ''}</span>
                      <IconChevron size={18} color="#9AA1A9" />
                    </span>
                  </a>
                  <button type="button" className="row-action" aria-label={`${formatKst(s.startedAt)} 기록 지우기`} onClick={() => setAsk({ id: s.id, when: formatKst(s.startedAt) })}>
                    <IconTrash size={20} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      {ask && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
              <h2 id="delete-title">기록을 지울까요?</h2>
              <p>
                {ask.when} 기록을 폰과 서버에서 모두 지워요. 되돌릴 수 없어요. 이 기록의 랩이 비교 랩(베스트)이었으면 다음으로 빠른 랩이 비교 랩이 돼요. 코스는
                남아요.
              </p>
              {error && <div className="notice warn">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
                  지우기
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setAsk(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}
    </Tabbed>
  );
}
