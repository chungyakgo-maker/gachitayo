// 기록 탭: 최근 주행 목록 → 종료 요약 다시 보기 (분석 화면은 다음 단계)
import { useRecording } from '../../app/recording';
import type { SessionStatus } from '../../types/session';
import { Tabbed } from '../components/TabBar';
import { formatDuration, formatKst, formatLapTime } from '../format';
import { IconChevron } from '../icons';

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
                <li key={s.id}>
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
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </Tabbed>
  );
}
