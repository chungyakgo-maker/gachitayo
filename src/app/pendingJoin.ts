// 카톡 초대 링크로 처음 연 사람: 첫 실행 안내·카카오 로그인(다른 페이지로 갔다 옴)을 마칠 때까지 방 코드를 들고 있는다 (30분)
const KEY = 'gachitayo.pendingJoin.v1';
const KEEP_MS = 30 * 60_000;

export function rememberPendingJoin(code: string, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: now }));
  } catch {
    // 저장 못 하면 링크를 다시 누르면 된다
  }
}

export function takePendingJoin(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const o = JSON.parse(raw) as { code?: unknown; at?: unknown };
    return typeof o.code === 'string' && /^\d{6}$/.test(o.code) && typeof o.at === 'number' && now - o.at < KEEP_MS ? o.code : null;
  } catch {
    return null;
  }
}
