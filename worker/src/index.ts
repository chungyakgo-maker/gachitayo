// 같이타요 API + 파일 게이트웨이 (사양서 6.5, 6.6, M6 결정: Cloudflare만)
//   POST /auth/signup {nickname}         익명 계정 만들기 → {userId, token} (폰 열쇠)
//   GET/PUT /api/me {nickname}           닉네임
//   GET /api/courses                     내 코스 목록
//   PUT /api/courses/{id}                코스 올리기 (같은 id면 덮어씀)
//   DELETE /api/courses/{id}             코스 지우기 (이 코스의 기록이 남아 있으면 409)
//   PUT /api/sessions/{id}               세션 올리기
//   PUT /api/sessions/{id}/laps [ … ]    세션의 랩을 통째로 바꾸기
//   DELETE /api/sessions/{id}            기록 지우기 (랩·세션 행, 원본·처리된 파일) (M10)
//   PUT/GET/HEAD /files/{userId}/{sessionId}.{raw|processed}.json.gz
//   GET /api/friends                     내 친구 코드와 친구 목록 (M8)
//   POST /api/friends {code}             친구 코드로 친구 맺기 (바로 서로 친구)
//   DELETE /api/friends/{id}             친구 끊기 (양쪽 모두)
//   GET /api/friends/presence            위치 공유 중인 친구의 위치 (2분 안에 받은 것만)
//   PUT /api/presence {lat, lon, …}      내 위치 공유 (마지막 하나만 저장)
//   DELETE /api/presence                 공유 끄기 (지운다)
//   GET /live/{userId} (WebSocket)       앞 친구 간격용 실시간 방 (M9). 본인 방이면 보내기, 친구 방이면 받기
//   GET /map/info, /map/tiles/{z}/{x}/{y}.mvt, /map/fonts/…   선 지도 (로그인 없이, map.ts)
// 응답: 400 잘못된 값, 401 로그인 필요, 403 다른 사람 것·허용하지 않은 출처, 404 없음, 405, 409 먼저 할 일이 남음, 413 너무 큼, 429 가입 제한
import { authenticate, signup, validNickname } from './auth';
import { deleteCourse, deleteSession, getMe, listCourses, putCourse, putLaps, putMe, putSession } from './data';
import { handleFiles } from './files';
import { handleMap } from './map';
import { addFriend, deletePresence, friendPresence, listFriends, putPresence, removeFriend } from './friends';
import { tokenFromProtocol } from './live';

export { LiveRoom } from './live';
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
      if (e.status === 405) headers.set('Allow', 'GET, PUT, POST, DELETE, HEAD, OPTIONS');
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
  if (path.startsWith('/map/')) return handleMap(req, env, path, headers);

  const live = /^\/live\/([^/]+)$/.exec(path);
  if (live) {
    if (method !== 'GET') throw new HttpError(405);
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new HttpError(426, 'WebSocket으로 연결해 주세요');
    const target = live[1]!.toLowerCase();
    if (!UUID_RE.test(target)) throw new HttpError(400, '잘못된 사용자 id');
    const userId = await authenticate(req, env, tokenFromProtocol(req));
    let role: 'leader' | 'follower' = 'leader';
    if (target !== userId) {
      const friend = await env.DB.prepare('SELECT 1 AS x FROM friends WHERE user_id = ? AND friend_id = ?').bind(userId, target).first();
      if (!friend) throw new HttpError(403, '친구만 볼 수 있어요');
      role = 'follower';
    }
    const fwd = new Request(req.url, { headers: { Upgrade: 'websocket', 'X-Live-Role': role } });
    return env.LIVE.get(env.LIVE.idFromName(target)).fetch(fwd);
  }

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
    if (method !== 'PUT' && method !== 'DELETE') throw new HttpError(405);
    const id = course[1]!;
    if (!UUID_RE.test(id)) throw new HttpError(400, '잘못된 코스 id');
    const userId = await authenticate(req, env);
    if (method === 'DELETE') return json(200, headers, await deleteCourse(env, userId, id.toLowerCase()));
    return json(200, headers, await putCourse(env, userId, id.toLowerCase(), await readJson(req, MAX_JSON_BYTES)));
  }

  const session = /^\/api\/sessions\/([^/]+)(\/laps)?$/.exec(path);
  if (session) {
    const id = session[1]!;
    if (method === 'DELETE' && !session[2]) {
      if (!UUID_RE.test(id)) throw new HttpError(400, '잘못된 세션 id');
      return json(200, headers, await deleteSession(env, await authenticate(req, env), id.toLowerCase()));
    }
    if (method !== 'PUT') throw new HttpError(405);
    if (!UUID_RE.test(id)) throw new HttpError(400, '잘못된 세션 id');
    const userId = await authenticate(req, env);
    const body = await readJson(req, MAX_JSON_BYTES);
    return json(200, headers, session[2] ? await putLaps(env, userId, id.toLowerCase(), body) : await putSession(env, userId, id.toLowerCase(), body));
  }

  if (path === '/api/friends') {
    const userId = await authenticate(req, env);
    if (method === 'GET') return json(200, headers, await listFriends(env, userId));
    if (method === 'POST') return json(200, headers, await addFriend(env, userId, await readJson(req, 4096)));
    throw new HttpError(405);
  }

  if (path === '/api/friends/presence') {
    if (method !== 'GET') throw new HttpError(405);
    return json(200, headers, await friendPresence(env, await authenticate(req, env)));
  }

  const friend = /^\/api\/friends\/([^/]+)$/.exec(path);
  if (friend) {
    if (method !== 'DELETE') throw new HttpError(405);
    return json(200, headers, await removeFriend(env, await authenticate(req, env), friend[1]!));
  }

  if (path === '/api/presence') {
    const userId = await authenticate(req, env);
    if (method === 'PUT') return json(200, headers, await putPresence(env, userId, await readJson(req, 4096)));
    if (method === 'DELETE') return json(200, headers, await deletePresence(env, userId));
    throw new HttpError(405);
  }

  throw new HttpError(404, '없는 주소');
}

export default {
  fetch(req: Request, env: Cloudflare.Env): Promise<Response> {
    return handle(req, env);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
