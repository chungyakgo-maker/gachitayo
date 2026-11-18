// 팀 (설계 docs/superpowers/specs/2026-11-18-team-drive-design.md, 사용자 요청 "팀 만들기 → 최대 인원 15명, 친구 등록한 인원들을 넣어",
// "주행 시작 → 팀 주행 → 팀이 여러 개면 선택 후 해당 팀으로 주행 (팀은 최대 5개)"):
// 내가 속한 팀 목록(팀원·사진·열린 주행), 만들기·고치기·지우기·나가기, 팀 주행 열기(→ 그룹 방으로 들어가기).
// 메인 화면이 보이는 동안 30초마다 다시 받아 "○○팀 주행 중"을 보여 준다.
import { useSyncExternalStore } from 'react';
import { ApiError, apiFetch } from '../server/api';
import { friendlyServerError, getAuth } from './account';
import { enterGroupRoom } from './group';

/** 내가 속한 팀 최대 수 (사용자 결정 B-가: 만든 팀 + 들어간 팀) */
export const TEAM_MAX = 5;
/** 한 팀 나 포함 인원 */
export const TEAM_SIZE = 15;
export const TEAM_NAME_MAX = 20;
const POLL_MS = 30_000;

export interface TeamMember {
  userId: string;
  nickname: string;
  avatar: string | null;
}
export interface Team {
  id: string;
  name: string;
  ownerId: string;
  /** 팀장이 맨 앞 */
  members: TeamMember[];
  gapS: number;
  /** 지금 열린 팀 주행 (몇 명 들어와 있나) */
  drive: { roomId: string; count: number } | null;
}
export interface TeamsState {
  teams: Team[];
  loaded: boolean;
}

const EMPTY: TeamsState = { teams: [], loaded: false };
let state: TeamsState = EMPTY;
const listeners = new Set<() => void>();
function set(p: Partial<TeamsState>): void {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export const getTeams = (): TeamsState => state;
export function useTeams(): TeamsState {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getTeams);
}

/** 팀 동작이 안 됐을 때 보여줄 말 (서버가 준 말: "팀은 5개까지예요" 등) */
export function teamErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status >= 400 && e.status < 500) return e.message;
  return friendlyServerError(e);
}

function token(): string {
  const auth = getAuth();
  if (!auth) throw new Error('계정이 있어야 팀을 쓸 수 있어요');
  return auth.token;
}

const replace = (t: Team) => set({ teams: state.teams.some((x) => x.id === t.id) ? state.teams.map((x) => (x.id === t.id ? t : x)) : [...state.teams, t] });

export async function loadTeams(): Promise<void> {
  const r = await apiFetch<{ teams: Team[] }>('GET', '/api/teams', { token: token() });
  set({ teams: r.teams, loaded: true });
}

export async function createTeam(name: string, memberIds: string[]): Promise<Team> {
  const t = await apiFetch<Team>('POST', '/api/teams', { token: token(), body: { name: name.trim(), memberIds } });
  replace(t);
  return t;
}

/** 팀장: 이름·팀원 바꾸기 (memberIds는 팀장 뺀 전체) */
export async function updateTeam(id: string, patch: { name?: string; memberIds?: string[] }): Promise<Team> {
  const t = await apiFetch<Team>('PUT', `/api/teams/${id}`, { token: token(), body: patch });
  replace(t);
  return t;
}

export async function deleteTeam(id: string): Promise<void> {
  await apiFetch('DELETE', `/api/teams/${id}`, { token: token() });
  set({ teams: state.teams.filter((t) => t.id !== id) });
}

export async function leaveTeam(id: string): Promise<void> {
  await apiFetch('POST', `/api/teams/${id}/leave`, { token: token() });
  set({ teams: state.teams.filter((t) => t.id !== id) });
}

/** 팀 주행 열기·들어가기: 이미 열려 있으면 그 방으로, 없으면 내가 방장으로 새로 연다 */
export async function openTeamDrive(id: string): Promise<void> {
  const r = await apiFetch<{ roomId: string }>('POST', `/api/teams/${id}/drive`, { token: token() });
  await enterGroupRoom(r.roomId);
  void loadTeams().catch(() => undefined);
}

/** 메인 화면이 보이는 동안: 지금 받고 30초마다 (화면이 꺼져 있으면 쉰다) */
export function watchTeams(): () => void {
  const tick = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!getAuth()) return;
    void loadTeams().catch(() => undefined);
  };
  tick();
  const id = setInterval(tick, POLL_MS);
  return () => clearInterval(id);
}

export function resetTeamsForTest(): void {
  state = EMPTY;
}
