// 설정 · 팀 (시안 ⑥, 설계 2026-11-18 team-drive): 내가 속한 팀(팀장·팀원 표시, 인원)과 팀 만들기 (최대 5개)
import { useEffect } from 'react';
import { getAuth, useAccount } from '../../app/account';
import { loadTeams, TEAM_MAX, useTeams } from '../../app/teams';

export function TeamsSection() {
  const acc = useAccount();
  const ts = useTeams();
  const me = getAuth()?.userId ?? null;
  useEffect(() => {
    if (acc.status === 'ready') void loadTeams().catch(() => undefined);
  }, [acc.status]);
  if (acc.status !== 'ready') return null;
  return (
    <section className="card card-col" style={{ gap: 8 }} aria-label="팀">
      <div className="card-row">
        <strong style={{ flex: 1 }}>팀</strong>
        <span className="sub">
          {ts.teams.length} / {TEAM_MAX}
        </span>
      </div>
      {ts.loaded && ts.teams.length === 0 && <span className="sub">친구들과 팀을 만들면 "주행 시작 → 팀 주행"으로 바로 같이 달려요</span>}
      {ts.teams.map((t) => {
        const owner = t.ownerId === me;
        return (
          <a key={t.id} className="team-item team-link" href={`#/team/${t.id}`}>
            <span className="team-name">
              {t.name}
              <span className={`badge${owner ? '' : ' mem'}`}>{owner ? '팀장' : '팀원'}</span>
            </span>
            <span className="sub" style={{ marginLeft: 'auto' }}>
              {t.members.length}명 ›
            </span>
          </a>
        );
      })}
      {ts.teams.length < TEAM_MAX ? (
        <a className="btn" href="#/team/new" style={{ textAlign: 'center', textDecoration: 'none' }}>
          ＋ 팀 만들기
        </a>
      ) : (
        <span className="sub">팀은 {TEAM_MAX}개까지예요. 새로 만들려면 하나를 지우거나 나가 주세요</span>
      )}
    </section>
  );
}
