// 앞 친구 간격용 실시간 연결 (사용자 요청, M9). 서버의 실시간 방(Durable Object)에 WebSocket으로 붙는다.
// - 보내기(앞차): 주행 중 위치 공유를 켰으면 내 GPS를 받을 때마다(1초에 한 번쯤) 내 방으로 보낸다
// - 받기(뒤차): 주행 준비에서 고른 앞 친구의 방에서 위치를 받아 모은다 → 화면이 간격을 계산한다
// 끊기면 2·4·8…초(최대 15초) 뒤 다시 붙는다. 주행이 끝나면 닫는다.
import { useSyncExternalStore } from 'react';
import { serverConfig } from '../server/config';
import { getAuth } from './account';
import { subscribeSamples } from './recording';

export interface LivePoint {
  /** GPS 기준 epoch ms */
  t: number;
  lat: number;
  lon: number;
  speed: number | null;
  heading: number | null;
  hAcc: number | null;
}

type WsFactory = (url: string, protocols: string[]) => WebSocket;
let makeWs: WsFactory = (url, protocols) => new WebSocket(url, protocols);
export function setWebSocketFactoryForTest(f: WsFactory): void {
  makeWs = f;
}

const wsUrl = (path: string) => serverConfig.apiUrl.replace(/^http/, 'ws') + path;

/** 다시 붙는 WebSocket: 열려 있는 동안 onOpen, 메시지마다 onMessage */
function keepConnected(path: string, onMessage: ((data: string) => void) | null, onState: (connected: boolean) => void): { send: (s: string) => void; close: () => void } {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const open = () => {
    const auth = getAuth();
    if (closed || !auth) return;
    ws = makeWs(wsUrl(path), ['gachitayo', auth.token]);
    ws.onopen = () => {
      retry = 0;
      onState(true);
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') onMessage?.(e.data);
    };
    ws.onclose = () => {
      onState(false);
      ws = null;
      if (closed) return;
      retry++;
      timer = setTimeout(open, Math.min(15_000, 1000 * 2 ** retry));
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return {
    send: (s) => {
      if (ws?.readyState === 1) ws.send(s);
    },
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
      ws = null;
    },
  };
}

export interface FollowState {
  friendId: string | null;
  nickname: string | null;
  connected: boolean;
  /** 받은 위치 (최근 3분) */
  points: LivePoint[];
}

let follow: FollowState = { friendId: null, nickname: null, connected: false, points: [] };
const listeners = new Set<() => void>();
const setFollow = (p: Partial<FollowState>) => {
  follow = { ...follow, ...p };
  listeners.forEach((l) => l());
};
export const getFollowState = (): FollowState => follow;

/** 재생 모드의 가상 앞 친구 (사용자 요청: 직접 시뮬 돌려보기). 실제 친구 연결 없이 따라가기 상태에 위치를 넣는다 */
export const VIRTUAL_FRIEND = { id: 'sim-friend', nickname: '지훈(가상)', /** 목표 간격 초 (sim/friendScenario와 같게) */ targetS: 2 } as const;

export function setVirtualFollow(on: boolean): void {
  if (on) setFollow({ friendId: VIRTUAL_FRIEND.id, nickname: VIRTUAL_FRIEND.nickname, connected: true, points: [] });
  else if (follow.friendId === VIRTUAL_FRIEND.id) setFollow({ friendId: null, nickname: null, connected: false, points: [] });
}

export function pushVirtualPoint(p: LivePoint): void {
  if (follow.friendId !== VIRTUAL_FRIEND.id) return;
  const pts = follow.points;
  if (pts.length && p.t <= pts[pts.length - 1]!.t) return;
  setFollow({ points: [...pts.filter((q) => q.t > p.t - KEEP_MS), p] });
}
export function useFollow(): FollowState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => follow,
  );
}

const KEEP_MS = 180_000;

function parsePoint(s: string): LivePoint | null {
  try {
    const o = JSON.parse(s) as LivePoint;
    return Number.isFinite(o.t) && Number.isFinite(o.lat) && Number.isFinite(o.lon) ? o : null;
  } catch {
    return null;
  }
}

let leader: { close: () => void } | null = null;
let follower: { close: () => void } | null = null;

/** 주행을 시작하거나 이어서 할 때: 앞 친구 받기, (위치 공유 중이면) 내 위치 보내기 */
export function startLiveLinks(opts: { friend: { id: string; nickname: string } | null; publish: boolean }): void {
  stopLiveLinks();
  const auth = getAuth();
  if (!auth || !serverConfig.apiUrl) return;
  if (opts.publish) {
    const link = keepConnected(`/live/${auth.userId}`, null, () => {});
    const unsub = subscribeSamples((e) => {
      if (e.kind !== 'gps') return;
      const g = e.s;
      link.send(JSON.stringify({ t: g.tFix, lat: g.lat, lon: g.lon, speed: g.speed, heading: g.heading, hAcc: g.hAcc }));
    });
    leader = {
      close: () => {
        unsub();
        link.close();
      },
    };
  }
  if (opts.friend) {
    setFollow({ friendId: opts.friend.id, nickname: opts.friend.nickname, connected: false, points: [] });
    const link = keepConnected(
      `/live/${opts.friend.id}`,
      (data) => {
        const p = parsePoint(data);
        if (!p) return;
        const pts = follow.points;
        if (pts.length && p.t <= pts[pts.length - 1]!.t) return;
        const keep = pts.filter((q) => q.t > p.t - KEEP_MS);
        setFollow({ points: [...keep, p] });
      },
      (connected) => setFollow({ connected }),
    );
    follower = { close: link.close };
  }
}

export function stopLiveLinks(): void {
  leader?.close();
  follower?.close();
  leader = null;
  follower = null;
  if (follow.friendId) setFollow({ friendId: null, nickname: null, connected: false, points: [] });
}
