// 팀 주행 시작 (사용자 요청 "팀 주행 → 팀이 여러 개면 선택 후 해당 팀으로 주행", 시안 ② 팀 고르기):
// 팀이 하나면 고르지 않고 바로 그 팀 대기실, 없으면 팀 만들기, 여러 개면 여기서 고른다.
import { useEffect, useRef, useState } from 'react';
import { getAuth } from '../../app/account';
import { loadTeams, openTeamDrive, teamErrorText, TEAM_MAX, useTeams, type Team } from '../../app/teams';
import { Sheet } from './Sheet';

export function TeamSheet({ onClose }: { onClose: () => void }) {
  const ts = useTeams();
  const me = getAuth()?.userId ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const auto = useRef(false);

  const pick = (t: Team) => {
    setBusy(t.id);
    setError(null);
    openTeamDrive(t.id).then(
      () => {
        onClose();
        window.location.hash = '#/group';
      },
      (e: unknown) => {
        setError(teamErrorText(e));
        setBusy(null);
      },
    );
  };

  useEffect(() => {
    void loadTeams().catch(() => undefined);
  }, []);
  // 팀이 하나면 바로, 없으면 팀 만들기로 (한 번만)
  useEffect(() => {
    if (!ts.loaded || auto.current) return;
    auto.current = true;
    if (ts.teams.length === 0) {
      onClose();
      window.location.hash = '#/team/new';
    } else if (ts.teams.length === 1) pick(ts.teams[0]!);
    // pick·onClose는 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts.loaded, ts.teams.length]);

  const single = ts.teams.length === 1;
  return (
    <Sheet title={single ? '팀 주행' : '팀 주행 · 팀 고르기'} onClose={onClose}>
      {!ts.loaded && <span className="sub">팀을 불러오는 중…</span>}
      {single && busy && <span className="sub">{ts.teams[0]!.name} 대기실로 가는 중…</span>}
      {ts.teams.length > 1 &&
        ts.teams.map((t) => {
          const owner = t.ownerId === me;
          return (
            <div key={t.id} className="team-item">
              <button type="button" className="team-pick" aria-label={`${t.name} 고르기`} disabled={!!busy} onClick={() => pick(t)}>
                <span className="team-name">
                  {t.name}
                  <span className={`badge${owner ? '' : ' mem'}`}>{owner ? '팀장' : '팀원'}</span>
                </span>
                <span className="sub">{t.members.length}명</span>
                {t.drive && <span className="team-live">● 지금 주행 중 · {t.drive.count}명 들어옴</span>}
                {busy === t.id && <span className="sub">들어가는 중…</span>}
              </button>
              <a className="btn small" href={`#/team/${t.id}`} aria-label={`${t.name} ${owner ? '편집' : '보기'}`} onClick={onClose}>
                {owner ? '편집' : '보기'}
              </a>
            </div>
          );
        })}
      {ts.teams.length > 1 && (
        <>
          <button
            type="button"
            className="btn"
            disabled={ts.teams.length >= TEAM_MAX}
            onClick={() => {
              onClose();
              window.location.hash = '#/team/new';
            }}
          >
            ＋ 팀 만들기 <span className="sub">{ts.teams.length} / {TEAM_MAX}</span>
          </button>
          <span className="sub">팀을 누르면 그 팀 대기실로 가요. 이미 누가 열었으면 거기로 들어가요</span>
        </>
      )}
      {error && (
        <span className="notice warn" role="alert">
          {error}
        </span>
      )}
    </Sheet>
  );
}
