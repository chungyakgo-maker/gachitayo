// 팀 주행 알리기 링크 #/team/{팀}/drive (설계 2026-11-18 team-drive, 시안 ③ "카톡으로 '주행 열었어요' 알리기"):
// 팀원이 누르면 계정이 준비되는 대로 그 팀 대기실로. 팀원이 아니거나 주행이 닫혔으면 알려 준다
import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../../app/account';
import { openTeamDrive, teamErrorText } from '../../app/teams';
import { IconBack } from '../icons';

export function TeamDriveLinkScreen({ teamId }: { teamId: string }) {
  const acc = useAccount();
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);
  useEffect(() => {
    if (acc.status !== 'ready' || tried.current) return;
    tried.current = true;
    openTeamDrive(teamId).then(
      () => {
        window.location.hash = '#/group';
      },
      (e: unknown) => setError(teamErrorText(e)),
    );
  }, [acc.status, teamId]);
  return (
    <main className="page">
      <header className="page-head">
        <a className="back-btn" href="#/" aria-label="메인으로">
          <IconBack size={24} />
        </a>
        <h1 style={{ flex: 1 }}>팀 주행</h1>
      </header>
      {error ? (
        <span className="notice warn" role="alert">
          {error}
        </span>
      ) : (
        <span className="sub" role="status">
          {acc.status === 'ready' ? '팀 대기실로 가는 중…' : '계정을 준비하는 중…'}
        </span>
      )}
      {error && (
        <a className="btn" href="#/" style={{ textAlign: 'center', textDecoration: 'none' }}>
          메인으로
        </a>
      )}
    </main>
  );
}
