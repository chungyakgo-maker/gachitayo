// 팀 만들기·편집·보기 (사용자 요청 "팀 만들기 → 최대 인원 15명, 친구 등록한 인원들을 넣어", 시안 ④, 설계 2026-11-18 team-drive):
// 친구 목록에서 체크해 넣는다(나 포함 15명, 묻지 않고 바로 팀원). 팀이 5개인 친구는 "팀이 가득 찬 친구"로 못 고른다.
// 팀장: 이름·팀원 바꾸기·팀 지우기. 팀원: 목록 보기·팀 나가기. #/team/new · #/team/{id}
import { useEffect, useMemo, useState } from 'react';
import { getAuth, useAccount } from '../../app/account';
import { loadFriends, useFriends } from '../../app/friends';
import { createTeam, deleteTeam, leaveTeam, loadTeams, teamErrorText, TEAM_MAX, TEAM_NAME_MAX, TEAM_SIZE, updateTeam, useTeams } from '../../app/teams';
import { Avatar } from '../components/Avatar';
import { IconBack } from '../icons';

function goBack(): void {
  if (window.history.length > 1) window.history.back();
  else window.location.hash = '#/settings';
}

interface Pickable {
  userId: string;
  nickname: string;
  avatar: string | null;
  full: boolean;
}

export function TeamEditScreen({ teamId }: { teamId: string | null }) {
  const acc = useAccount();
  const fr = useFriends();
  const ts = useTeams();
  const me = getAuth()?.userId ?? null;
  const team = teamId ? (ts.teams.find((t) => t.id === teamId) ?? null) : null;
  const owner = !teamId || team?.ownerId === me;
  const [name, setName] = useState(team?.name ?? '');
  const [picked, setPicked] = useState<string[]>(() => team?.members.filter((m) => m.userId !== team.ownerId).map((m) => m.userId) ?? []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (acc.status !== 'ready') return;
    void loadFriends();
    if (!ts.loaded) void loadTeams().catch(() => undefined);
    // 처음 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acc.status]);
  // 팀을 늦게 받아 왔으면 그때 채운다
  const [filled, setFilled] = useState(!!team || !teamId);
  useEffect(() => {
    if (filled || !team) return;
    setFilled(true);
    setName(team.name);
    setPicked(team.members.filter((m) => m.userId !== team.ownerId).map((m) => m.userId));
  }, [team, filled]);

  // 고를 수 있는 사람: 친구 + (편집이면) 이미 팀원인 사람 (친구를 끊었어도 남아 있다)
  const people = useMemo<Pickable[]>(() => {
    const out: Pickable[] = fr.friends.map((f) => ({ userId: f.userId, nickname: f.nickname, avatar: f.avatar ?? null, full: !!f.full }));
    for (const m of team?.members ?? []) if (m.userId !== me && !out.some((p) => p.userId === m.userId)) out.push({ ...m, full: false });
    return out;
  }, [fr.friends, team, me]);

  const run = (f: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    setNote(null);
    f().then(
      () => {
        setBusy(false);
        after();
      },
      (e: unknown) => {
        setError(teamErrorText(e));
        setBusy(false);
      },
    );
  };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const count = picked.length + 1;
  const nameOk = name.trim().length > 0;

  const title = !teamId ? '팀 만들기' : owner ? '팀 편집' : (team?.name ?? '팀');
  return (
    <main className="page" style={{ gap: 12 }}>
      <header className="page-head">
        <button type="button" className="back-btn" aria-label="뒤로" onClick={goBack}>
          <IconBack size={24} />
        </button>
        <h1 style={{ flex: 1 }}>{title}</h1>
      </header>
      {acc.status !== 'ready' && <span className="notice warn">팀은 서버 계정이 있어야 해요. 통신이 연결되면 계정이 만들어져요.</span>}
      {teamId && !team && <span className="sub">{ts.loaded ? '팀을 찾지 못했어요' : '팀을 불러오는 중…'}</span>}

      {(!teamId || team) && owner && (
        <>
          <span className="card-col" style={{ gap: 6 }}>
            <label htmlFor="team-name" className="label">
              팀 이름
            </label>
            <input id="team-name" className="text-input" type="text" value={name} maxLength={TEAM_NAME_MAX} placeholder="예: 북악 새벽팀" onChange={(e) => setName(e.target.value)} />
          </span>
          <section className="card card-col" style={{ gap: 0 }} aria-label="팀원 고르기">
            <div className="card-row" style={{ paddingBottom: 8 }}>
              <span className="label" style={{ flex: 1 }}>
                팀원 고르기 · 친구 중에서
              </span>
              <span className="team-count">
                나 포함 {count} / {TEAM_SIZE}명
              </span>
            </div>
            {fr.loaded && people.length === 0 && <span className="sub">아직 친구가 없어요. 설정 › 친구에서 카톡으로 친구 초대부터 해 주세요</span>}
            {people.map((p) => {
              const on = picked.includes(p.userId);
              const off = !on && (p.full || count >= TEAM_SIZE);
              return (
                <div key={p.userId} className={`pick${on ? ' on' : ''}${off ? ' off' : ''}`}>
                  <label className="pick-label">
                    <input type="checkbox" checked={on} disabled={off || busy} onChange={() => toggle(p.userId)} />
                    <Avatar id={p.avatar} name={p.nickname} />
                    <span>{p.nickname}</span>
                    {p.full && !on && <span className="why">팀이 가득 찬 친구 ({TEAM_MAX}팀)</span>}
                  </label>
                </div>
              );
            })}
          </section>
          <span className="sub">고른 친구는 묻지 않고 바로 팀원이 돼요. 친구가 아니면 설정 › 친구에서 카톡으로 친구 초대부터</span>
          {note && (
            <span className="notice" role="status">
              {note}
            </span>
          )}
          {error && (
            <span className="notice warn" role="alert">
              {error}
            </span>
          )}
          {!teamId ? (
            <button type="button" className="primary-btn" disabled={busy || !nameOk || acc.status !== 'ready'} onClick={() => run(() => createTeam(name, picked), goBack)}>
              팀 만들기
            </button>
          ) : (
            <>
              <button type="button" className="primary-btn" disabled={busy || !nameOk} onClick={() => run(() => updateTeam(teamId, { name: name.trim(), memberIds: picked }), () => setNote('저장했어요'))}>
                저장
              </button>
              <button
                type="button"
                className="ghost-btn danger"
                disabled={busy}
                onClick={() => {
                  if (!confirm) return setConfirm(true);
                  run(() => deleteTeam(teamId), goBack);
                }}
              >
                {confirm ? '한 번 더 누르면 팀을 지워요' : '팀 지우기'}
              </button>
            </>
          )}
        </>
      )}

      {team && !owner && (
        <>
          <section className="card card-col" style={{ gap: 0 }} aria-label="팀원">
            <span className="label" style={{ paddingBottom: 8 }}>
              팀원 {team.members.length}명
            </span>
            {team.members.map((m) => (
              <div key={m.userId} className="pick">
                <Avatar id={m.avatar} name={m.nickname} />
                <span>{m.userId === me ? `${m.nickname} (나)` : m.nickname}</span>
                {m.userId === team.ownerId && <span className="badge">팀장</span>}
              </div>
            ))}
          </section>
          {error && (
            <span className="notice warn" role="alert">
              {error}
            </span>
          )}
          <button
            type="button"
            className="ghost-btn danger"
            disabled={busy}
            onClick={() => {
              if (!confirm) return setConfirm(true);
              run(() => leaveTeam(team.id), goBack);
            }}
          >
            {confirm ? '한 번 더 누르면 팀에서 나가요' : '팀 나가기'}
          </button>
        </>
      )}
    </main>
  );
}
