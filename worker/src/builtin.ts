// 기본 코스 목록 (사양서 7.5, 2026-11-27 세영 "코스 추가될 때마다 앱 배포 다시 안 하는 방향으로 … 웹 앱 통일"):
// 웹·앱이 열 때 이 목록을 받아 기본 코스를 넣고 고친다 → 코스를 더하거나 고칠 때 앱 심사 없이 main 배포만 하면 된다.
// 원본은 앱과 같은 파일(src/courses/builtinMeta.ts · builtinData.ts)을 그대로 묶는다 — 두 벌로 갈라지지 않게.
//   GET /api/builtin-courses          {courses: [{key, name, route, desc?, oldNames?, tags?, rev?}]} 목록 순서대로 (점 없음, 작다)
//   GET /api/builtin-courses/{key}    {key, rev, points: [위도, 경도, …]} 그 코스의 경로 점 (새로 넣거나 선을 고칠 때만)
// 로그인 없이. 지점 캐시 5분 (배포 뒤 늦어도 5분이면 새 목록)
import { BUILTIN_POINTS } from '../../src/courses/builtinData';
import { BUNDLED_BUILTINS } from '../../src/courses/builtinMeta';
import { HttpError, json } from './http';

const CACHE = 'public, max-age=300';

export function handleBuiltin(req: Request, path: string, headers: Headers): Response | null {
  if (path === '/api/builtin-courses') {
    if (req.method !== 'GET') throw new HttpError(405);
    headers.set('Cache-Control', CACHE);
    return json(200, headers, { courses: BUNDLED_BUILTINS.filter((b) => BUILTIN_POINTS[b.key]) });
  }
  const m = /^\/api\/builtin-courses\/([a-z0-9-]{1,64})$/.exec(path);
  if (!m) return null;
  if (req.method !== 'GET') throw new HttpError(405);
  const b = BUNDLED_BUILTINS.find((x) => x.key === m[1]);
  const points = b && BUILTIN_POINTS[b.key];
  if (!b || !points) throw new HttpError(404, '그런 기본 코스가 없어요');
  headers.set('Cache-Control', CACHE);
  return json(200, headers, { key: b.key, rev: b.rev ?? 1, points });
}
