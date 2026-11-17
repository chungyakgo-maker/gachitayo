// 응답·CORS·본문 읽기 공통
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message = String(status),
  ) {
    super(message);
  }
}

/** 아이폰 앱(디고, Capacitor)의 출처 (사양서 13.3) */
export const APP_ORIGINS = ['capacitor://localhost'] as const;

/** 받는 출처: 웹앱 주소(ALLOWED_ORIGIN)와 아이폰 앱 */
export function isAllowedOrigin(origin: string | null, env: Cloudflare.Env): boolean {
  return origin !== null && (origin === env.ALLOWED_ORIGIN || (APP_ORIGINS as readonly string[]).includes(origin));
}

export function corsHeaders(origin: string | null, env: Cloudflare.Env): Headers {
  const h = new Headers();
  if (origin && isAllowedOrigin(origin, env)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    h.set('Access-Control-Expose-Headers', 'Content-Length, ETag');
    h.set('Access-Control-Max-Age', '86400');
    h.set('Vary', 'Origin');
  }
  return h;
}

export function json(status: number, headers: Headers, body: unknown): Response {
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(status: number, headers: Headers, message?: string): Response {
  return json(status, headers, { error: message ?? String(status) });
}

/** 본문을 최대 크기까지만 읽는다. 넘으면 413 */
export async function readLimited(req: Request, max: number): Promise<Uint8Array> {
  const declared = req.headers.get('Content-Length');
  if (declared !== null && Number(declared) > max) throw new HttpError(413, '너무 큼');
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, '너무 큼');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export async function readJson(req: Request, max: number): Promise<unknown> {
  const bytes = await readLimited(req, max);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'JSON 형식 오류');
  }
}
