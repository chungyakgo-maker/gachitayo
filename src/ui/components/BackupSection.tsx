// 설정 › 백업 (기록은 폰에만 7단계, 시안 ②③): 기록은 서버에 없으니 폰을 바꿀 땐 파일로 옮긴다.
// 만들기는 아이폰 공유 창("파일"에 저장·카톡 등, 웹은 내려받기) — 공유 창은 탭 처리 안에서 열어야 해서 단추에서 바로 부른다.
// 불러오기는 파일을 고른 뒤 확인 창에서 한 번 더 묻고, 없는 것만 더한다.
import { useRef, useState } from 'react';
import { importBackup, lastBackup, peekBackup, shareBackup } from '../../app/backup';
import type { BackupManifest } from '../../backup/backupFile';
import { formatBytes, formatDayKst } from '../format';
import { Overlay } from './Overlay';

export function BackupSection() {
  const [last, setLast] = useState(lastBackup);
  const [busy, setBusy] = useState<'make' | 'load' | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [ask, setAsk] = useState<{ file: File; m: BackupManifest } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const make = () => {
    setBusy('make');
    setMsg(null);
    void shareBackup()
      .then(() => setLast(lastBackup()))
      .catch((e: Error) => setMsg({ text: e.message, warn: true }))
      .finally(() => setBusy(null));
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      setAsk({ file: f, m: await peekBackup(f) });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), warn: true });
    }
  };
  const load = () => {
    if (!ask) return;
    setBusy('load');
    void importBackup(ask.file)
      .then((r) => setMsg({ text: `기록 ${r.sessions}개 · 내 코스 ${r.courses}개를 더했어요${r.skipped ? ` (이미 있던 기록 ${r.skipped}개는 그대로)` : ''}` }))
      .catch((e: Error) => setMsg({ text: e.message, warn: true }))
      .finally(() => {
        setBusy(null);
        setAsk(null);
      });
  };
  return (
    <section className="card card-col" style={{ gap: 10 }} aria-label="백업">
      <span className="label">백업</span>
      <span style={{ fontSize: 14, lineHeight: 1.5 }}>기록은 이 폰에만 있어요. 폰을 바꾸거나 앱을 지우기 전에 백업 파일을 만들어 두세요.</span>
      <button type="button" className="btn accent" disabled={busy !== null} onClick={make}>
        {busy === 'make' ? '백업 파일 만드는 중…' : '전체 백업 파일 만들기'}
      </button>
      <button type="button" className="btn" disabled={busy !== null} onClick={() => input.current?.click()}>
        백업 파일 불러오기
      </button>
      <input ref={input} type="file" accept=".dgo,application/octet-stream,application/zip" hidden aria-label="백업 파일 고르기" onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      <span className="sub">{last ? `마지막 백업 ${formatDayKst(last.at)} · ${formatBytes(last.bytes)}` : '아직 백업한 적이 없어요'}</span>
      {msg && (
        <span className={`notice${msg.warn ? ' warn' : ''}`} role="status">
          {msg.text}
        </span>
      )}
      {ask && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="backup-load-title">
              <h2 id="backup-load-title">백업 파일을 불러올까요?</h2>
              <p>
                <strong>{ask.file.name.replace(/\.dgo$/i, '')}</strong>
                <br />
                기록 {ask.m.sessions}개 · 내 코스 {ask.m.courses}개
              </p>
              <p>이 폰에 이미 있는 기록은 그대로 두고, 없는 것만 더해요.</p>
              <div className="modal-actions">
                <button type="button" className="btn accent" disabled={busy !== null} onClick={load}>
                  {busy === 'load' ? '불러오는 중…' : '불러오기'}
                </button>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => setAsk(null)}>
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
