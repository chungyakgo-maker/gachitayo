// 기본 코스 목록 (2026-11-27 세영 "코스 추가될 때마다 앱 배포 다시 안 하는 방향으로 … 웹 앱 통일"): 로그인 없이 목록·점을 준다
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/index';
import { BUILTIN_POINTS } from '../../src/courses/builtinData';
import { BUNDLED_BUILTINS } from '../../src/courses/builtinMeta';

const ORIGIN = 'https://example.github.io';
const get = (path: string, method = 'GET') => handle(new Request(`https://api.example.workers.dev${path}`, { method, headers: { Origin: ORIGIN } }), env);

describe('기본 코스 목록 (Worker)', () => {
  it('목록: 앱과 같은 파일, 같은 순서, 점은 빼고, 서킷 분류·고친 차례·설명 포함. 로그인 없이, 5분 캐시', async () => {
    const r = await get('/api/builtin-courses');
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=300');
    const body = (await r.json()) as { courses: Array<{ key: string; tags?: string[]; rev?: number; desc?: string[]; points?: unknown }> };
    expect(body.courses.map((c) => c.key)).toEqual(BUNDLED_BUILTINS.map((b) => b.key));
    expect(body.courses.every((c) => c.points === undefined)).toBe(true);
    const inje = body.courses.find((c) => c.key === 'inje-speedium')!;
    expect(inje.tags).toEqual(['circuit']);
    expect(inje.rev).toBe(2);
    expect(inje.desc!.length).toBeGreaterThan(0);
  });

  it('코스 점: 그 코스의 [위도, 경도, …]와 고친 차례 (없는 차례는 1)', async () => {
    const r = await get('/api/builtin-courses/inje-speedium');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ key: 'inje-speedium', rev: 2, points: BUILTIN_POINTS['inje-speedium'] });
    const b = (await (await get('/api/builtin-courses/baehuryeong')).json()) as { rev: number };
    expect(b.rev).toBe(1);
  });

  it('없는 코스는 404, GET 말고는 405', async () => {
    expect((await get('/api/builtin-courses/nope')).status).toBe(404);
    expect((await get('/api/builtin-courses', 'POST')).status).toBe(405);
  });
});
