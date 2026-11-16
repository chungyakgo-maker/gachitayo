// 그룹 주행 (설계 docs/superpowers/specs/2026-11-16-group-drive-design.md, 사용자 요청 "방 만들고 그룹주행"):
// 방 만들기·코드로 들어가기, 방 상태와 다른 사람 위치 받기(웹소켓), 주행 중 내 GPS 보내기, 방장 동작(순서·차 간격·목적지),
// 방장이 정한 목적지 경로를 참가자에게 "이 경로로 진행"으로 묻고, 받으면 경로 안내를 켠다.
import { useSyncExternalStore } from 'react';
import { ApiError, apiFetch } from '../server/api';
import { friendlyServerError, getAuth } from './account';
import { getDriveState, subscribeDrive } from './drive';
import { keepConnected, type LivePoint } from './liveLink';
import { subscribeSamples } from './recording';
import { getNavLive, replaceNavRoute, startNavWithRoute, type RouteData } from './routeNav';

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
  /** 방장이 새로 정한 목적지 (참가자가 아직 안 받음) */
  offer: GroupOffer | null;
  /** "나중에"를 누른 목적지 (대기실에서 다시 받을 수 있다. 같은 판은 다시 묻지 않는다) */
  later: GroupOffer | null;
  /** 받은(또는 내가 정한) 경로 판 */
  acceptedVersion: number;
  error: string | null;
}

const ROOM_KEY = 'gachitayo.groupRoom.v1';
const KEEP_MS = 180_000;
/** 한 사람 위치를 이만큼까지만 들고 있는다 (1초에 한 번 · 3분) */
const KEEP_POINTS = 200;
const EMPTY: GroupState = { room: null, me: null, connected: false, offer: null, later: null, acceptedVersion: 0, error: null };

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

// 다른 사람 위치는 따로 둔다 (검토 지적: 위치가 올 때마다 메인·대기실까지 다시 그렸다). 주행 화면만 본다
export type GroupPoints = Record<string, LivePoint[]>;
let points: GroupPoints = {};
const pointListeners = new Set<() => void>();
function setPoints(p: GroupPoints): void {
  points = p;
  pointListeners.forEach((l) => l());
}
export const getGroupPoints = (): GroupPoints => points;
export function useGroupPoints(): GroupPoints {
  return useSyncExternalStore((cb) => {
    pointListeners.add(cb);
    return () => pointListeners.delete(cb);
  }, getGroupPoints);
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
/** 지금 연결 번호 (닫은 연결이 늦게 알려 오는 것은 무시한다) */
let linkSeq = 0;
let unsubGps: (() => void) | null = null;
let unsubDrive: (() => void) | null = null;
let lastSent = 0;
/** 받은(또는 방장이 정한) 경로: 출발할 때마다 이 경로로 안내 (지금 방 판과 같을 때만) */
let accepted: GroupOffer | null = null;
/** 방 열기 번호: 늦게 끝난 열기는 버린다 */
let openSeq = 0;
/** 만들기·코드 입장이 진행 중 (앱을 열 때 예전 방으로 돌아가기가 끼어들지 않게) */
let explicitBusy = 0;
/** 지금 받아 오는 경로 판 */
let fetching = 0;

/** 방 동작이 안 됐을 때 보여줄 말 (서버가 준 말: "방을 찾지 못했어요", "방이 가득 찼어요" 등) */
export function groupErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status >= 400 && e.status < 500) return e.message;
  return friendlyServerError(e);
}

function token(): string {
  const auth = getAuth();
  if (!auth) throw new Error('계정이 있어야 그룹 주행을 할 수 있어요');
  return auth.token;
}

function remember(roomId: string, acceptedVersion: number): void {
  try {
    localStorage.setItem(ROOM_KEY, JSON.stringify({ roomId, accepted: acceptedVersion }));
  } catch {
    // 저장 못 해도 이번 실행 동안은 방에 있다
  }
}
function remembered(): { roomId: string; accepted: number } | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { roomId?: unknown; accepted?: unknown };
    if (typeof o.roomId === 'string') return { roomId: o.roomId, accepted: typeof o.accepted === 'number' ? o.accepted : 0 };
  } catch {
    // 예전 형식: 방 id 글자 그대로
  }
  return { roomId: raw, accepted: 0 };
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
    const pts = (points[p.userId] ?? []).filter((q) => q.t > p.t - KEEP_MS && q.t < p.t).slice(-(KEEP_POINTS - 1));
    pts.push({ t: p.t, lat: p.lat, lon: p.lon, speed: p.speed ?? null, heading: p.heading ?? null, hAcc: p.hAcc ?? null });
    setPoints({ ...points, [p.userId]: pts });
  }
}

/** 방장이 목적지를 새로 정했으면 경로를 받아 참가자에게 묻는다.
 *  방장 자신, 또는 이미 받았던 판(앱을 다시 열었을 때)은 묻지 않고 바로 받는다. 같은 판은 한 번만 받아 온다 */
async function checkRoute(): Promise<void> {
  const room = state.room;
  if (!room?.dest) return;
  const v = room.routeVersion;
  const settled = () => accepted?.version === v || state.offer?.version === v || state.later?.version === v;
  if (settled() || fetching === v) return;
  fetching = v;
  try {
    const route = await apiFetch<(RouteData & { version?: number }) | null>('GET', `/api/rooms/${room.roomId}/route`, { token: token() });
    const cur = state.room;
    // 그사이 방·판이 바뀌었거나 이미 답했으면 버린다 (검토 지적: 받은 뒤 다시 묻는 창이 떴다)
    if (!route || !cur?.dest || cur.roomId !== room.roomId || cur.routeVersion !== v || (route.version !== undefined && route.version !== v) || settled()) return;
    const offer: GroupOffer = { version: v, dest: cur.dest, route: { points: route.points, distanceM: route.distanceM, durationS: route.durationS, destName: route.destName ?? null } };
    if (isGroupHost(state) || v <= state.acceptedVersion) applyOffer(offer);
    else set({ offer, later: null });
  } catch {
    // 다음 상태 때 다시
  } finally {
    if (fetching === v) fetching = 0;
  }
}

function applyOffer(o: GroupOffer): void {
  accepted = o;
  set({ offer: null, later: null, acceptedVersion: o.version });
  if (state.room) remember(state.room.roomId, o.version);
  // 주행 중이면 바로 바꾸고, 아니면 출발할 때 켠다 (startGroupNav)
  if (getDriveState().phase !== 'idle') replaceNavRoute(o.route, o.dest);
}

export function acceptRouteOffer(): void {
  if (state.offer) applyOffer(state.offer);
}
export function dismissRouteOffer(): void {
  set({ offer: null, later: state.offer });
}
/** 대기실에서 "나중에" 했던 목적지를 다시 묻는다 */
export function reopenRouteOffer(): void {
  if (state.later && state.later.version === state.room?.routeVersion) set({ offer: state.later, later: null });
}
/** 출발 때 켤 경로가 있는지 (대기실 안내) */
export const hasPendingRoute = (): boolean => !!accepted && accepted.version === state.room?.routeVersion && getNavLive() === null;

/** 방이 닫혔는지 확인 (연결이 끊겼을 때, 30초에 한 번까지). 닫혔거나 내가 빠졌으면 이 폰에서도 잊는다 */
let lastVerify = 0;
async function verifyRoom(): Promise<void> {
  const room = state.room;
  if (!room || Date.now() - lastVerify < 30_000) return;
  lastVerify = Date.now();
  try {
    await apiFetch('GET', `/api/rooms/${room.roomId}`, { token: token() });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404) && state.room?.roomId === room.roomId) leaveGroupLocal();
  }
}

function connect(roomId: string): void {
  link?.close();
  unsubGps?.();
  const my = ++linkSeq;
  link = keepConnected(
    `/group/${roomId}`,
    (d) => my === linkSeq && onMessage(d),
    (c) => {
      if (my !== linkSeq) return;
      set({ connected: c });
      if (!c) void verifyRoom();
    },
  );
  // 주행 중일 때만 내 GPS를 보낸다 (1초에 한 번쯤)
  unsubGps = subscribeSamples((e) => {
    const ev = e as { kind: string; s: { tFix: number; lat: number; lon: number; speed: number | null; heading: number | null; hAcc: number | null } };
    if (ev.kind !== 'gps' || getDriveState().phase !== 'driving') return;
    const g = ev.s;
    if (g.tFix - lastSent < 900) return;
    lastSent = g.tFix;
    link?.send(JSON.stringify({ t: g.tFix, lat: g.lat, lon: g.lon, speed: g.speed, heading: g.heading, hAcc: g.hAcc }));
  });
  // 주행을 어떻게 시작하든 받은 경로가 있으면 안내를 켠다 (검토 지적: 두 번째 출발부터 안내가 없었다)
  if (!unsubDrive) {
    let lastPhase = getDriveState().phase;
    unsubDrive = subscribeDrive(() => {
      const d = getDriveState();
      if (lastPhase === 'idle' && d.phase !== 'idle' && !d.replay) startGroupNav();
      lastPhase = d.phase;
    });
  }
}

async function open(roomId: string, seq: number, acceptedVersion = 0): Promise<boolean> {
  const room = await apiFetch<GroupRoomState>('GET', `/api/rooms/${roomId}`, { token: token() });
  if (seq !== openSeq) return false;
  remember(roomId, acceptedVersion);
  accepted = null;
  fetching = 0;
  setPoints({});
  set({ ...EMPTY, room: { ...room, roomId }, me: getAuth()?.userId ?? null, acceptedVersion });
  connect(roomId);
  void checkRoute();
  return true;
}

async function explicit(f: (seq: number) => Promise<void>): Promise<void> {
  const seq = ++openSeq;
  explicitBusy++;
  try {
    await f(seq);
  } finally {
    explicitBusy--;
  }
}

export function createGroupRoom(): Promise<void> {
  return explicit(async (seq) => {
    const r = await apiFetch<{ roomId: string; code: string }>('POST', '/api/rooms', { token: token() });
    await open(r.roomId, seq);
  });
}

export function joinGroupRoom(code: string): Promise<void> {
  return explicit(async (seq) => {
    const r = await apiFetch<{ roomId: string }>('POST', '/api/rooms/join', { token: token(), body: { code: code.replace(/\D/g, '') } });
    const keep = remembered();
    await open(r.roomId, seq, keep?.roomId === r.roomId ? keep.accepted : 0);
  });
}

/** 앱을 다시 열면 들어가 있던 방으로. 방이 닫혔거나(24시간) 내가 빠졌으면 잊고, 통신이 안 되면 기억해 두고 연결되면 다시 */
export async function resumeGroupRoom(): Promise<void> {
  const keep = remembered();
  if (!keep || state.room || explicitBusy > 0) return;
  const seq = openSeq;
  try {
    await open(keep.roomId, seq, keep.accepted);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
      if (seq === openSeq) leaveGroupLocal();
    } else if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void resumeGroupRoom(), { once: true });
    }
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

/** 출발: 받은 경로가 지금 방 판이면 그 경로로 안내를 켠다. 이미 다른 안내 중이면(목적지 화면에서 출발 등) 그대로 둔다 */
export function startGroupNav(): void {
  const o = accepted;
  if (!o || !state.room || o.version !== state.room.routeVersion || getNavLive() !== null) return;
  startNavWithRoute(o.route, o.dest);
}

/** 서버에 알리지 않고 이 폰에서만 방을 잊는다 (로그아웃, 방이 닫힘) */
export function leaveGroupLocal(): void {
  linkSeq++;
  link?.close();
  link = null;
  unsubGps?.();
  unsubGps = null;
  unsubDrive?.();
  unsubDrive = null;
  accepted = null;
  fetching = 0;
  try {
    localStorage.removeItem(ROOM_KEY);
  } catch {
    // 지울 수 없어도 상태는 비운다
  }
  setPoints({});
  set(EMPTY);
}

export async function leaveGroupRoom(): Promise<void> {
  try {
    await post('leave');
  } catch {
    // 통신이 안 돼도 이 폰에서는 나간다 (24시간 뒤 방이 닫힌다)
  }
  leaveGroupLocal();
}
