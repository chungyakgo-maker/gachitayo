// 재생 모드 (사양서 10.2): 저장된 기록이나 가상 주행을 주행 화면에 실제 속도나 배속으로 흘려보낸다.
import { useState } from 'react';
import { startReplay, useDrive } from '../../app/drive';
import { useRecording } from '../../app/recording';
import { formatKst } from '../format';
import { IconBack } from '../icons';

const SPEEDS = [1, 5, 10];

export function ReplayScreen() {
  const { sessions, sessionId } = useRecording();
  const { error } = useDrive();
  const [speed, setSpeed] = useState(5);
  const [busy, setBusy] = useState(false);
  const run = (src: Parameters<typeof startReplay>[0]) => {
    setBusy(true);
    void startReplay(src, speed).finally(() => setBusy(false));
  };
  const list = sessions.filter((s) => s.id !== sessionId && s.status !== 'recording');
  return (
    <main className="page page-full">
      <header className="page-head">
        <a className="back-btn" href="#/settings" aria-label="설정으로">
          <IconBack size={24} />
        </a>
        <h1>재생 모드</h1>
      </header>
      <p className="dim" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
        운전하지 않고 주행 화면과 델타를 확인합니다. 기록하거나 저장하지 않습니다. 주행 화면에서 길게 누르면 끝납니다.
      </p>
      <section className="card-col" style={{ gap: 8 }} aria-label="재생 속도">
        <span className="label">재생 속도</span>
        <div className="segmented" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {SPEEDS.map((v) => (
            <button key={v} type="button" aria-pressed={speed === v} onClick={() => setSpeed(v)}>
              {v}×
            </button>
          ))}
        </div>
      </section>
      {error && <div className="notice warn">{error}</div>}
      <section className="card-col" style={{ gap: 8 }} aria-label="가상 주행">
        <span className="label">가상 주행 (오벌 서킷 3바퀴)</span>
        <button type="button" className="sheet-item" disabled={busy} onClick={() => run({ kind: 'sim', withRef: true })}>
          <span className="card-col">
            <strong>비교 랩 있음</strong>
            <span className="sub">베스트보다 2% 느리게: 델타·고스트·구간 델타</span>
          </span>
        </button>
        <button type="button" className="sheet-item" disabled={busy} onClick={() => run({ kind: 'sim', withRef: false })}>
          <span className="card-col">
            <strong>첫 주행</strong>
            <span className="sub">코스 없음: 속도·경과 시간·지나온 경로</span>
          </span>
        </button>
      </section>
      <section className="card-col" style={{ gap: 8 }} aria-label="가상 친구 따라가기">
        <span className="label">앞 친구 간격 (가상 친구)</span>
        <button type="button" className="sheet-item" disabled={busy} onClick={() => run({ kind: 'friendSim' })}>
          <span className="card-col">
            <strong>가상 친구 따라가기</strong>
            <span className="sub">
              앞에 가상 친구 '지훈'이 달려요. 목표 간격 2.0초로 멂(+0.7) → 유지(0.0) → 가까움(−0.6) → 66초에 신호 끊김. 친구 위치는 실제처럼 1초마다, 0.8초 늦게 와요. 1×로 보세요
            </span>
          </span>
        </button>
      </section>
      <section className="card-col" style={{ gap: 8 }} aria-label="저장된 기록">
        <span className="label">저장된 기록</span>
        {list.length === 0 ? (
          <div className="empty">저장된 기록이 없어요.</div>
        ) : (
          list.map((s) => (
            <button key={s.id} type="button" className="sheet-item" disabled={busy} onClick={() => run({ kind: 'session', id: s.id })}>
              <span className="card-col">
                <strong className="mono">{formatKst(s.startedAt)}</strong>
                <span className="sub">
                  {s.summary?.courseName ?? '코스 없음'}
                  {s.summary ? ` · ${s.summary.lapCount}랩` : ''}
                </span>
              </span>
            </button>
          ))
        )}
      </section>
      {busy && <div className="notice">준비하는 중…</div>}
    </main>
  );
}
