// 팀 주행 시작 (사용자 요청 "팀 주행 → 팀이 여러 개면 선택 후 해당 팀으로 주행", 시안 ② 팀 고르기):
// 팀 목록을 새로 받은 다음, 팀이 하나면 고르지 않고 바로 그 팀 대기실, 없으면 팀 만들기, 여러 개면 여기서 고른다.
// (검토 지적: 저장된 옛 목록으로 고르면 틀린 팀으로 가거나, 목록을 못 받으면 "불러오는 중"에 멈췄다)
import { useEffect, useRef, useState } from 'react';
import { getAuth } from '../../app/account';
import { getTeams, loadTeams, openTeamDrive, teamErrorText, TEAM_MAX, useTeams, type Team } from '../../app/teams';
import { Sheet } from './Sheet';

export function TeamSheet({ onClose }: { onClose: () => void }) {
  const ts = useTeams();
  const me = getAuth()?.userId ?? null;
  /** 이번에 목록을 새로 받았나 */
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 다시 해 보기가 할 일 */
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const auto = useRef(false);

  const pick = (t: Team) => {
    setBusy(t.id);
    setError(null);
    setRetry(null);
    openTeamDrive(t.id).then(
      () => {
        onClose();
        window.location.hash = '#/group';
      },
      (e: unknown) => {
        setError(teamErrorText(e));
        setBusy(null);
        setRetry(() => () => pick(t));
      },
    );
  };
  const load = () => {
    setError(null);
    setRetry(null);
    loadTeams().then(
      () => setFresh(true),
      (e: unknown) => {
        setError(teamErrorText(e));
        setRetry(() => load);
      },
    );
  };

  useEffect(() => {
    load();
    // 처음 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 새로 받은 목록으로: 팀이 하나면 바로, 없으면 팀 만들기로 (한 번만)
  useEffect(() => {
    if (!fresh || auto.current) return;
    auto.current = true;
    const teams = getTeams().teams;
    if (teams.length === 0) {
      onClose();
      window.location.hash = '#/team/new';
    } else if (teams.length === 1) pick(teams[0]!);
    // pick·onClose는 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  const many = fresh && ts.teams.length > 1;
  const single = fresh && ts.teams.length === 1;
  return (
    <Sheet title={many ? '팀 주행 · 팀 고르기' : '팀 주행'} onClose={onClose}>
      {!fresh && !error && <span className="sub">팀을 불러오는 중…</span>}
      {single && busy && <span className="sub">{ts.teams[0]!.name} 대기실로 가는 중…</span>}
      {many &&
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
      {many && (
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
      {retry && !many && (
        <button type="button" className="btn" onClick={retry}>
          다시 해 보기
        </button>
      )}
    </Sheet>
  );
}
