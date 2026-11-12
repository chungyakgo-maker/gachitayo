// 파일 게이트웨이 (사양서 6.6): Supabase 토큰을 확인하고 본인 폴더의 파일만 R2에 저장·제공한다.
//   PUT  /files/{userId}/{sessionId}.{raw|processed}.json.gz  저장 (같은 키면 덮어씀)
//   GET  같은 경로  내려받기
//   HEAD 같은 경로  존재와 크기 확인 (업로드 확인용)
// 응답: 400 잘못된 경로, 401 토큰 없음·무효, 403 다른 사람 폴더·허용하지 않은 출처, 404 없음, 405 메서드, 413 너무 큼
import { verifyToken, type Jwks } from './jwt';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const PATH = new RegExp(`^/files/(${UUID})/(${UUID})\\.(raw|processed)\\.json\\.gz$`);

export interface Deps {
  fetchJwks: () => Promise<Jwks>;
}

function defaultDeps(env: Cloudflare.Env): Deps {
  return {
    fetchJwks: async () => {
      const r = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
      if (!r.ok) throw new Error(`JWKS ${r.status}`);
      return (await r.json()) as Jwks;
    },
  };
}

function corsHeaders(origin: string | null, env: Cloudflare.Env): Headers {
  const h = new Headers();
  if (origin && origin === env.ALLOWED_ORIGIN) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Methods', 'GET, PUT, HEAD, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    h.set('Access-Control-Expose-Headers', 'Content-Length, ETag');
    h.set('Access-Control-Max-Age', '86400');
    h.set('Vary', 'Origin');
  }
  return h;
}

function reply(status: number, headers: Headers, body: BodyInit | null = null): Response {
  if (body === null && status >= 400) {
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    body = String(status);
  }
  return new Response(body, { status, headers });
}

/** 본문을 최대 크기까지만 읽는다. 넘으면 null */
async function readLimited(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = req.headers.get('Content-Length');
  if (declared !== null && Number(declared) > max) return null;
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
      return null;
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

export async function handle(req: Request, env: Cloudflare.Env, deps: Deps = defaultDeps(env)): Promise<Response> {
  const origin = req.headers.get('Origin');
  // 브라우저 요청인데 출처가 다르면 막는다 (Origin이 없는 요청은 브라우저 밖이라 CORS와 무관)
  if (origin !== null && origin !== env.ALLOWED_ORIGIN) return reply(403, new Headers());
  const headers = corsHeaders(origin, env);
  if (req.method === 'OPTIONS') return reply(204, headers);
  if (!['GET', 'PUT', 'HEAD'].includes(req.method)) {
    headers.set('Allow', 'GET, PUT, HEAD, OPTIONS');
    return reply(405, headers);
  }

  const m = PATH.exec(new URL(req.url).pathname);
  if (!m) return reply(400, headers);
  const [, userId, sessionId, kind] = m as unknown as [string, string, string, string];

  const auth = req.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return reply(401, headers);
  const sub = await verifyToken(token, { issuer: `${env.SUPABASE_URL}/auth/v1`, fetchJwks: deps.fetchJwks, hsSecret: env.SUPABASE_JWT_SECRET });
  if (!sub) return reply(401, headers);
  if (sub.toLowerCase() !== userId.toLowerCase()) return reply(403, headers);

  const key = `${userId.toLowerCase()}/${sessionId.toLowerCase()}.${kind}.json.gz`;
  if (req.method === 'PUT') {
    const body = await readLimited(req, MAX_FILE_BYTES);
    if (!body) return reply(413, headers);
    const obj = await env.SESSION_FILES.put(key, body, { httpMetadata: { contentType: 'application/gzip' } });
    headers.set('Content-Type', 'application/json');
    return reply(201, headers, JSON.stringify({ key, size: obj?.size ?? body.byteLength }));
  }
  if (req.method === 'HEAD') {
    const obj = await env.SESSION_FILES.head(key);
    if (!obj) return reply(404, headers);
    headers.set('Content-Length', String(obj.size));
    headers.set('ETag', obj.httpEtag);
    return new Response(null, { status: 200, headers });
  }
  const obj = await env.SESSION_FILES.get(key);
  if (!obj) return reply(404, headers);
  headers.set('Content-Type', 'application/gzip');
  headers.set('Content-Length', String(obj.size));
  headers.set('ETag', obj.httpEtag);
  return new Response(obj.body, { status: 200, headers });
}

export default {
  fetch(req: Request, env: Cloudflare.Env): Promise<Response> {
    return handle(req, env);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
