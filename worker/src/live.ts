// 앞 친구 간격용 실시간 전달 (사용자 요청, M9): 사람마다 방(Durable Object) 하나.
// 방 주인(앞 친구)이 주행 중 위치 공유를 켜면 이 방으로 위치를 1초에 1~2번 보내고, 친구들(뒤차)이 같은 방에
// 붙어 그대로 받는다. 위치는 저장하지 않는다(마지막 하나만 메모리에, 새로 붙은 친구에게 바로 주려고).
// 연결이 없으면 잠들어(하이버네이션) 비용이 거의 없다.
import { DurableObject } from 'cloudflare:workers';

export type LiveRole = 'leader' | 'follower';

/** 방 주인이 보내는 위치 (이 모양만 친구에게 전한다) */
export interface LivePoint {
  /** GPS 기준 epoch ms */
  t: number;
  lat: number;
  lon: number;
  speed: number | null;
  heading: number | null;
  hAcc: number | null;
}

const finite = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);

/** 받은 글자 → 전할 위치. 모양이 틀리면 null */
export function parseLivePoint(msg: string): LivePoint | null {
  if (msg.length > 512) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(msg) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const t = finite(o.t, 1e12, 1e14);
  const lat = finite(o.lat, -90, 90);
  const lon = finite(o.lon, -180, 180);
  if (t === null || lat === null || lon === null) return null;
  return { t, lat, lon, speed: finite(o.speed, 0, 200), heading: finite(o.heading, 0, 360), hAcc: finite(o.hAcc, 0, 100_000) };
}

export class LiveRoom extends DurableObject<Cloudflare.Env> {
  private last: string | null = null;

  async fetch(req: Request): Promise<Response> {
    const role = req.headers.get('X-Live-Role') as LiveRole | null;
    if (role !== 'leader' && role !== 'follower') return new Response('잘못된 역할', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [role]);
    if (role === 'follower' && this.last) server.send(this.last);
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'gachitayo' } });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    if (!this.ctx.getTags(ws).includes('leader') || typeof msg !== 'string') return;
    const p = parseLivePoint(msg);
    if (!p) return;
    const out = JSON.stringify(p);
    this.last = out;
    for (const f of this.ctx.getWebSockets('follower')) {
      try {
        f.send(out);
      } catch {
        // 끊긴 연결은 런타임이 정리한다
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // 이미 닫힘
    }
  }
}

/** 브라우저 WebSocket은 머리글을 못 붙여서, 열쇠를 하위 프로토콜로 받는다: new WebSocket(url, ['gachitayo', 열쇠]) */
export function tokenFromProtocol(req: Request): string | null {
  const h = req.headers.get('Sec-WebSocket-Protocol');
  if (!h) return null;
  const parts = h.split(',').map((s) => s.trim());
  if (parts[0] !== 'gachitayo' || !parts[1]) return null;
  return parts[1];
}
