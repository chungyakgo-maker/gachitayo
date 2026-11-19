// 기록 탭 맨 위 백업 알림 (기록은 폰에만 7단계, 시안 ⑤): 기록이 5개 이상이고 마지막 백업(없으면 첫 기록) 뒤 30일이 지나면 한 번.
// 닫으면 30일 동안 다시 안 뜬다. "백업하기"는 공유 창을 바로 연다
import { useState } from 'react';
import { backupReminderDue, lastBackup, shareBackup, snoozeBackupReminder } from '../../app/backup';
import type { SessionRecord } from '../../types/session';

export function BackupNudge({ sessions }: { sessions: SessionRecord[] }) {
  const done = sessions.filter((s) => s.status === 'processed' || s.status === 'uploaded');
  const oldest = done.length ? Math.min(...done.map((s) => s.startedAt)) : null;
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  if (hidden || !backupReminderDue(Date.now(), done.length, oldest)) return null;
  const close = () => {
    snoozeBackupReminder();
    setHidden(true);
  };
  return (
    <div className="notice backup-nudge" role="status">
      <span style={{ flex: 1, minWidth: 0 }}>{lastBackup() ? '마지막 백업이 30일 지났어요' : '아직 백업 파일이 없어요 · 기록은 이 폰에만 있어요'}</span>
      <button
        type="button"
        className="btn small accent"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void shareBackup()
            .then((r) => r !== 'cancelled' && setHidden(true))
            .catch(() => {})
            .finally(() => setBusy(false));
        }}
      >
        백업하기
      </button>
      <button type="button" className="help-nudge-x" aria-label="백업 알림 닫기" onClick={close}>
        ✕
      </button>
    </div>
  );
}
