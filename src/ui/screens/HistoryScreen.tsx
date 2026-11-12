// 기록 탭: 최근 주행 목록 → 분석 (사양서 8.6). 계산 전 기록은 종료 요약에서 계산한다.
// 기록 지우기 (M10, 사용자 요청): 휴지통 → 확인 창 → 폰과 서버에서 지운다.
import { useRef, useState } from 'react';
import { useRecording } from '../../app/recording';
import { deleteSessionRecord } from '../../app/sync';
import { importRawFile } from '../../app/rawTransfer';
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const onImport = async (f: File | undefined) => {
    if (!f) return;
    setImportMsg({ text: '가져와서 계산하는 중…' });
    try {
      const id = await importRawFile(f);
      setImportMsg(null);
      window.location.hash = `#/analysis/${id}`;
    } catch (e) {
      setImportMsg({ text: e instanceof Error ? e.message : String(e), warn: true });
    }
  };
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
          <h1 className="big" style={{ flex: 1 }}>
            기록
          </h1>
          <button type="button" className="btn small" onClick={() => fileInput.current?.click()}>
            원본 파일 가져오기
          </button>
        </header>
        <input
          ref={fileInput}
          type="file"
          accept=".gz,.json,application/gzip,application/json"
          hidden
          aria-label="원본 파일 고르기"
          onChange={(e) => void onImport(e.target.files?.[0]).finally(() => (e.target.value = ''))}
        />
        {importMsg && <div className={`notice${importMsg.warn ? ' warn' : ''}`}>{importMsg.text}</div>}
        {list.length === 0 ? (
          <div className="empty">아직 주행 기록이 없어요.</div>
        ) : (
          <ul className="rows">
            {list.map((s) => {
              const sum = s.summary;
              return (
                <li key={s.id} className="row-with-action">
                  <a className="row-card" href={s.status === 'processed' || s.status === 'uploaded' ? `#/analysis/${s.id}` : `#/summary/${s.id}`}>
                    <span className="card-col">
                      <strong style={{ fontSize: 15 }} className="mono">
                        {formatKst(s.startedAt)}
                      </strong>
                      <span className="sub">
                        {sum?.courseName ?? '코스 없음'}
                        {sum ? ` · ${sum.lapCount}랩` : ''}
                        {s.endedAt ? ` · ${formatDuration(s.endedAt - s.startedAt)}` : ''}
                        {STATUS[s.status] ? ` · ${STATUS[s.status]}` : ''}
                        {s.imported ? ' · 가져온 기록' : ''}
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
