// 카톡으로 받은 링크로 처음 연 사람: 첫 실행 안내·카카오 로그인(다른 페이지로 갔다 옴)을 마칠 때까지 그 링크를 들고 있는다 (30분)
// 방 코드 초대 #/join/{코드}, 친구 초대 #/friend/{코드}/{이름}, 팀 주행 알리기 #/team/{팀}/drive (설계 2026-11-18 team-drive)
const KEY = 'gachitayo.pendingJoin.v1';
const KEEP_MS = 30 * 60_000;
/** 들고 있을 수 있는 링크 모양 (다른 주소로 끌려가지 않게) */
const LINK_RE = /^\/(join\/\d{6}|friend\/[2-9A-HJKMNP-Z]{8}(\/[^/]{1,40})?|team\/[0-9a-f-]{36}\/drive)$/;

export function rememberPendingLink(path: string, now = Date.now()): void {
  if (!LINK_RE.test(path)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: now }));
  } catch {
    // 저장 못 하면 링크를 다시 누르면 된다
  }
}

export function takePendingLink(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const o = JSON.parse(raw) as { path?: unknown; code?: unknown; at?: unknown };
    if (typeof o.at !== 'number' || now - o.at >= KEEP_MS) return null;
    // 예전 형식: 방 코드만
    const path = typeof o.path === 'string' ? o.path : typeof o.code === 'string' ? `/join/${o.code}` : null;
    return path && LINK_RE.test(path) ? path : null;
  } catch {
    return null;
  }
}

export const rememberPendingJoin = (code: string, now = Date.now()): void => rememberPendingLink(`/join/${code}`, now);

/** 들고 있던 것이 방 코드 초대면 그 코드 (다른 링크면 버리지 않고 그대로 둔다) */
export function takePendingJoin(now = Date.now()): string | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const path = takePendingLink(now);
  const m = path ? /^\/join\/(\d{6})$/.exec(path) : null;
  if (m) return m[1]!;
  if (path) rememberPendingLink(path, now);
  return null;
}
