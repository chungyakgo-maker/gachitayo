// 파일 게이트웨이 (사양서 6.6): 본인 폴더의 파일만 R2에 저장·제공한다.
//   PUT  /files/{userId}/{sessionId}.{raw|processed}.json.gz  저장 (같은 키면 덮어씀)
//   GET  같은 경로  내려받기 / HEAD 같은 경로  존재와 크기 확인 (업로드 확인용)
import { authenticate } from './auth';
import { HttpError, readLimited } from './http';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const PATH = new RegExp(`^/files/(${UUID})/(${UUID})\\.(raw|processed)\\.json\\.gz$`);

export async function handleFiles(req: Request, env: Cloudflare.Env, path: string, headers: Headers): Promise<Response> {
  if (!['GET', 'PUT', 'HEAD'].includes(req.method)) throw new HttpError(405);
  const m = PATH.exec(path);
  if (!m) throw new HttpError(400, '잘못된 파일 경로');
  const [, userId, sessionId, kind] = m as unknown as [string, string, string, string];
  const sub = await authenticate(req, env);
  if (sub.toLowerCase() !== userId.toLowerCase()) throw new HttpError(403, '다른 사람의 폴더');

  const key = `${userId.toLowerCase()}/${sessionId.toLowerCase()}.${kind}.json.gz`;
  if (req.method === 'PUT') {
    const body = await readLimited(req, MAX_FILE_BYTES);
    const obj = await env.SESSION_FILES.put(key, body, { httpMetadata: { contentType: 'application/gzip' } });
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ key, size: obj?.size ?? body.byteLength }), { status: 201, headers });
  }
  if (req.method === 'HEAD') {
    const obj = await env.SESSION_FILES.head(key);
    if (!obj) throw new HttpError(404, '없음');
    headers.set('Content-Length', String(obj.size));
    headers.set('ETag', obj.httpEtag);
    return new Response(null, { status: 200, headers });
  }
  const obj = await env.SESSION_FILES.get(key);
  if (!obj) throw new HttpError(404, '없음');
  headers.set('Content-Type', 'application/gzip');
  headers.set('Content-Length', String(obj.size));
  headers.set('ETag', obj.httpEtag);
  return new Response(obj.body, { status: 200, headers });
}
