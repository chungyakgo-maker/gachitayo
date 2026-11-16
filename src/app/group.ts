// 그룹 주행 (설계 docs/superpowers/specs/2026-11-16-group-drive-design.md, 사용자 요청 "방 만들고 그룹주행"):
// 방 만들기·코드로 들어가기, 방 상태와 다른 사람 위치 받기(웹소켓), 주행 중 내 GPS 보내기, 방장 동작(순서·차 간격·목적지),
// 방장이 정한 목적지 경로를 참가자에게 "이 경로로 진행"으로 묻고, 받으면 경로 안내를 켠다.
import { useSyncExternalStore } from 'react';
import { apiFetch } from '../server/api';
import { getAuth } from './account';
import { getDriveState } from './drive';
import { keepConnected, type LivePoint } from './liveLink';
import { subscribeSamples } from './recording';
import { replaceNavRoute, startNavWithRoute, type RouteData } from './routeNav';

/** 들어온 순서로 하나씩 (방 안에서 안 겹침, 서버 색 번호 0~7) */
export const GROUP_COLORS = ['#5ac8fa', '#ff9f43', '#2ecc71', '#ff6b9a', '#ffd23f', '#c084fc', '#22d3ee', '#a3e635'] as const;
export const groupColor = (i: number): string => GROUP_COLORS[((i % 8) + 8) % 8]!;

export interface GroupMember {
  userId: string;
  nickname: string;
  color: number;
  order: number;
  host: boolean;
}
export interface GroupRoomState {
  roomId: string;
  code: string;
  members: GroupMember[];
  gapS: number;
  dest: { name: string; lat: number; lon: number } | null;
  routeVersion: number;
}
export interface GroupOffer {
  version: number;
  dest: { name: string; lat: number; lon: number };
  route: RouteData;
}
export interface GroupState {
  room: GroupRoomState | null;
  me: string | null;
  connected: boolean;
  /** 다른 사람 위치 (최근 3분) */
  points: Record<string, LivePoint[]>;
  /** 방장이 새로 정한 목적지 (참가자가 아직 안 받음) */
  offer: GroupOffer | null;
  /** 받은(또는 내가 정한) 경로 판 */
  acceptedVersion: number;
  error: string | null;
}

const ROOM_KEY = 'gachitayo.groupRoom.v1';
const KEEP_MS = 180_000;
const EMPTY: GroupState = { room: null, me: null, connected: false, points: {}, offer: null, acceptedVersion: 0, error: null };

let state: GroupState = EMPTY;
const listeners = new Set<() => void>();
function set(p: Partial<GroupState>): void {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export const getGroup = (): GroupState => state;
export function useGroup(): GroupState {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getGroup);
}

export const myMember = (s: GroupState): GroupMember | null => s.room?.members.find((m) => m.userId === s.me) ?? null;
export const isGroupHost = (s: GroupState): boolean => !!myMember(s)?.host;

/** 순서상 바로 앞 사람 (1번은 없음) */
export function frontMember(s: GroupState): GroupMember | null {
  const me = myMember(s);
  if (!me || !s.room) return null;
  return s.room.members.find((m) => m.order === me.order - 1) ?? null;
}

let link: { send: (s: string) => void; close: () => void } | null = null;
let unsubGps: (() => void) | null = null;
let lastSent = 0;

function token(): string {
  const auth = getAuth();
  if (!auth) throw new Error('계정이 있어야 그룹 주행을 할 수 있어요');
  return auth.token;
}

function onMessage(data: string): void {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  if (m.type === 'state') {
    const room = m as unknown as GroupRoomState;
    set({ room: { roomId: room.roomId || state.room?.roomId || '', code: room.code, members: room.members, gapS: room.gapS, dest: room.dest, routeVersion: room.routeVersion } });
    void checkRoute();
  } else if (m.type === 'pos' && typeof m.userId === 'string') {
    const p = m as unknown as LivePoint & { userId: string };
    if (!Number.isFinite(p.t) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
    const pts = (state.points[p.userId] ?? []).filter((q) => q.t > p.t - KEEP_MS && q.t < p.t);
    pts.push({ t: p.t, lat: p.lat, lon: p.lon, speed: p.speed ?? null, heading: p.heading ?? null, hAcc: p.hAcc ?? null });
    set({ points: { ...state.points, [p.userId]: pts } });
  }
}

/** 방장이 목적지를 새로 정했으면 경로를 받아 참가자에게 묻는다 (방장 자신은 바로 받는다) */
async function checkRoute(): Promise<void> {
  const room = state.room;
  if (!room?.dest || room.routeVersion <= state.acceptedVersion || state.offer?.version === room.routeVersion) return;
  try {
    const route = await apiFetch<RouteData | null>('GET', `/api/rooms/${room.roomId}/route`, { token: token() });
    if (!route || state.room?.routeVersion !== room.routeVersion) return;
    const offer: GroupOffer = { version: room.routeVersion, dest: room.dest, route: { ...route, destName: route.destName ?? null } };
    if (isGroupHost(state)) applyOffer(offer);
    else set({ offer });
  } catch {
    // 다음 상태 때 다시
  }
}

function applyOffer(o: GroupOffer): void {
  set({ offer: null, acceptedVersion: o.version });
  // 주행 중이면 바로 바꾸고, 아니면 출발 때 켠다 (startGroupDrive)
  if (getDriveState().phase !== 'idle') replaceNavRoute(o.route, o.dest);
  else pendingRoute = o;
}
let pendingRoute: GroupOffer | null = null;

export function acceptRouteOffer(): void {
  if (state.offer) applyOffer(state.offer);
}
export function dismissRouteOffer(): void {
  set({ offer: null });
}

function connect(roomId: string): void {
  link?.close();
  unsubGps?.();
  link = keepConnected(`/group/${roomId}`, onMessage, (c) => set({ connected: c }));
  // 주행 중일 때만 내 GPS를 보낸다 (1초에 한 번쯤)
  unsubGps = subscribeSamples((e) => {
    const ev = e as { kind: string; s: { tFix: number; lat: number; lon: number; speed: number | null; heading: number | null; hAcc: number | null } };
    if (ev.kind !== 'gps' || getDriveState().phase !== 'driving') return;
    const g = ev.s;
    if (g.tFix - lastSent < 900) return;
    lastSent = g.tFix;
    link?.send(JSON.stringify({ t: g.tFix, lat: g.lat, lon: g.lon, speed: g.speed, heading: g.heading, hAcc: g.hAcc }));
  });
}

async function open(roomId: string): Promise<void> {
  const room = await apiFetch<GroupRoomState>('GET', `/api/rooms/${roomId}`, { token: token() });
  try {
    localStorage.setItem(ROOM_KEY, roomId);
  } catch {
    // 저장 못 해도 이번 실행 동안은 방에 있다
  }
  set({ ...EMPTY, room: { ...room, roomId }, me: getAuth()?.userId ?? null });
  connect(roomId);
  void checkRoute();
}

export async function createGroupRoom(): Promise<void> {
  const r = await apiFetch<{ roomId: string; code: string }>('POST', '/api/rooms', { token: token() });
  await open(r.roomId);
}

export async function joinGroupRoom(code: string): Promise<void> {
  const r = await apiFetch<{ roomId: string }>('POST', '/api/rooms/join', { token: token(), body: { code: code.replace(/\D/g, '') } });
  await open(r.roomId);
}

/** 앱을 다시 열면 들어가 있던 방으로 (24시간이 지났거나 나갔으면 잊는다) */
export async function resumeGroupRoom(): Promise<void> {
  let id: string | null = null;
  try {
    id = localStorage.getItem(ROOM_KEY);
  } catch {
    id = null;
  }
  if (!id || state.room) return;
  try {
    await open(id);
  } catch {
    leaveGroupLocal();
  }
}

const post = (action: string, body?: unknown) => {
  const room = state.room;
  if (!room) return Promise.reject(new Error('방이 없어요'));
  return apiFetch('POST', `/api/rooms/${room.roomId}/${action}`, { token: token(), body });
};

export const setGroupOrder = (userIds: string[]) => post('order', { userIds });
export const setGroupGap = (gapS: number) => post('gap', { gapS });
export async function shareGroupDestination(dest: { name: string; lat: number; lon: number }, route: RouteData): Promise<void> {
  await post('dest', { name: dest.name, lat: dest.lat, lon: dest.lon, route: { points: route.points, distanceM: route.distanceM, durationS: route.durationS } });
}

/** 방장: 순서 한 칸 올리기·내리기 */
export async function moveGroupMember(userId: string, d: -1 | 1): Promise<void> {
  const ms = [...(state.room?.members ?? [])].sort((a, b) => a.order - b.order);
  const i = ms.findIndex((m) => m.userId === userId);
  const j = i + d;
  if (i < 0 || j < 0 || j >= ms.length) return;
  [ms[i], ms[j]] = [ms[j]!, ms[i]!];
  await setGroupOrder(ms.map((m) => m.userId));
}

/** 출발: 받은 경로가 있으면 그 경로로 안내를 켠다 (주행 준비는 부른 쪽이 탭 안에서 연다) */
export function startGroupNav(): void {
  const o = pendingRoute;
  pendingRoute = null;
  if (o) startNavWithRoute(o.route, o.dest);
}

/** 서버에 알리지 않고 이 폰에서만 방을 잊는다 */
export function leaveGroupLocal(): void {
  link?.close();
  link = null;
  unsubGps?.();
  unsubGps = null;
  pendingRoute = null;
  try {
    localStorage.removeItem(ROOM_KEY);
  } catch {
    // 지울 수 없어도 상태는 비운다
  }
  set(EMPTY);
}

export async function leaveGroupRoom(): Promise<void> {
  try {
    await post('leave');
  } catch {
    // 통신이 안 돼도 이 폰에서는 나간다 (24시간 뒤 방이 사라진다)
  }
  leaveGroupLocal();
}
