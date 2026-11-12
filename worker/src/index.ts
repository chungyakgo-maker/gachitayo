// 같이타요 API + 파일 게이트웨이 (사양서 6.5, 6.6, M6 결정: Cloudflare만)
//   POST /auth/signup {nickname}         익명 계정 만들기 → {userId, token} (폰 열쇠)
//   GET/PUT /api/me {nickname}           닉네임
//   GET /api/courses                     내 코스 목록
//   PUT /api/courses/{id}                코스 올리기 (같은 id면 덮어씀)
//   PUT /api/sessions/{id}               세션 올리기
//   PUT /api/sessions/{id}/laps [ … ]    세션의 랩을 통째로 바꾸기
//   PUT/GET/HEAD /files/{userId}/{sessionId}.{raw|processed}.json.gz
// 응답: 400 잘못된 값, 401 로그인 필요, 403 다른 사람 것·허용하지 않은 출처, 404 없음, 405, 413 너무 큼, 429 가입 제한
import { authenticate, signup, validNickname } from './auth';
import { getMe, listCourses, putCourse, putLaps, putMe, putSession } from './data';
import { handleFiles } from './files';
import { corsHeaders, errorResponse, HttpError, json, readJson, UUID_RE } from './http';

/** 표 API 본문 최대 크기 (긴 코스 중심선, 랩 trace 묶음) */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

export async function handle(req: Request, env: Cloudflare.Env): Promise<Response> {
  const origin = req.headers.get('Origin');
  // 브라우저 요청인데 출처가 다르면 막는다 (Origin이 없는 요청은 브라우저 밖이라 CORS와 무관)
  if (origin !== null && origin !== env.ALLOWED_ORIGIN) return errorResponse(403, new Headers(), '허용하지 않은 출처');
  const headers = corsHeaders(origin, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    return await route(req, env, headers);
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 405) headers.set('Allow', 'GET, PUT, POST, HEAD, OPTIONS');
      return req.method === 'HEAD' ? new Response(null, { status: e.status, headers }) : errorResponse(e.status, headers, e.message);
    }
    console.error(e);
    return errorResponse(500, headers, '서버 오류');
  }
}

async function route(req: Request, env: Cloudflare.Env, headers: Headers): Promise<Response> {
  const path = new URL(req.url).pathname;
  const method = req.method;

  if (path.startsWith('/files/')) return handleFiles(req, env, path, headers);

  if (path === '/auth/signup') {
    if (method !== 'POST') throw new HttpError(405);
    const body = await readJson(req, 4096);
    const nickname = validNickname((body as { nickname?: unknown } | null)?.nickname);
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    return json(201, headers, await signup(env, nickname, ip));
  }

  if (path === '/api/me') {
    const userId = await authenticate(req, env);
    if (method === 'GET') return json(200, headers, await getMe(env, userId));
    if (method === 'PUT') {
      const body = await readJson(req, 4096);
      return json(200, headers, await putMe(env, userId, validNickname((body as { nickname?: unknown } | null)?.nickname)));
    }
    throw new HttpError(405);
  }

  if (path === '/api/courses') {
    if (method !== 'GET') throw new HttpError(405);
    return json(200, headers, await listCourses(env, await authenticate(req, env)));
  }

  const course = /^\/api\/courses\/([^/]+)$/.exec(path);
  if (course) {
    if (method !== 'PUT') throw new HttpError(405);
    const id = course[1]!;
    if (!UUID_RE.test(id)) throw new HttpError(400, '잘못된 코스 id');
    const userId = await authenticate(req, env);
    return json(200, headers, await putCourse(env, userId, id.toLowerCase(), await readJson(req, MAX_JSON_BYTES)));
  }

  const session = /^\/api\/sessions\/([^/]+)(\/laps)?$/.exec(path);
  if (session) {
    if (method !== 'PUT') throw new HttpError(405);
    const id = session[1]!;
    if (!UUID_RE.test(id)) throw new HttpError(400, '잘못된 세션 id');
    const userId = await authenticate(req, env);
    const body = await readJson(req, MAX_JSON_BYTES);
    return json(200, headers, session[2] ? await putLaps(env, userId, id.toLowerCase(), body) : await putSession(env, userId, id.toLowerCase(), body));
  }

  throw new HttpError(404, '없는 주소');
}

export default {
  fetch(req: Request, env: Cloudflare.Env): Promise<Response> {
    return handle(req, env);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
