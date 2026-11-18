// 메인 화면 맨 위 (시안 ⑤): 내 팀이 주행을 열었으면 "○○팀 주행 중 · N명 · 들어가기". 알림(푸시)이 없어서 메인에서 알려 준다
import { useState } from 'react';
import { useGroup } from '../../app/group';
import { openTeamDrive, teamErrorText, useTeams } from '../../app/teams';

export function TeamNotice() {
  const ts = useTeams();
  const g = useGroup();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 이미 방에 들어가 있으면 메인 화면의 방 바로 가기가 따로 있다
  if (g.room) return null;
  const live = ts.teams.find((t) => t.drive && t.drive.count > 0);
  if (!live) return null;
  const go = () => {
    setBusy(true);
    setError(null);
    openTeamDrive(live.id).then(
      () => {
        window.location.hash = '#/group';
      },
      (e: unknown) => {
        setError(teamErrorText(e));
        setBusy(false);
      },
    );
  };
  return (
    <>
      <div className="notice team-notice">
        <span className="live-dot" aria-hidden="true" />
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong>{live.name}</strong> 주행 중 · {live.drive!.count}명
        </span>
        <button type="button" className="btn small accent" disabled={busy} onClick={go}>
          들어가기
        </button>
      </div>
      {error && (
        <span className="notice warn" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
