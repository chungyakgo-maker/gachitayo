// 선 지도 경로 테스트 (사양서 8.9): R2에 작은 지도 파일을 넣고 타일·정보·글자 조각을 꺼낸다.
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { handle } from '../src/index';
import { MAP_KEY } from '../src/map';
import { KOREA_SMALL_PMTILES } from './fixtures/koreaSmall';

const ORIGIN = 'https://example.github.io';
const get = (path: string, init: { method?: string; origin?: string | null } = {}) =>
  handle(new Request(`https://api.example.workers.dev${path}`, { method: init.method ?? 'GET', headers: init.origin === null ? {} : { Origin: init.origin ?? ORIGIN } }), env);
const put = () => env.MAP.put(MAP_KEY, KOREA_SMALL_PMTILES);
/** 압축된 채로 온 조각을 풀어 글자로 */
const unzip = async (r: Response) => new TextDecoder().decode(await new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());

afterEach(async () => {
  await env.MAP.delete(MAP_KEY);
});

describe('선 지도 (Worker)', () => {
  it('지도 파일이 없으면 정보·타일 모두 404 (앱은 예전 사진 지도로)', async () => {
    expect((await get('/map/info')).status).toBe(404);
    expect((await get('/map/tiles/0/0/0.mvt')).status).toBe(404);
  });

  it('정보: 확대 범위·영역·가운데', async () => {
    await put();
    const r = await get('/map/info');
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const body = (await r.json()) as { minZoom: number; maxZoom: number; bounds: number[]; center: number[] };
    expect(body).toMatchObject({ minZoom: 0, maxZoom: 14 });
    expect(body.bounds.map((v) => Math.round(v * 10) / 10)).toEqual([124.5, 33, 131, 38.7]);
    expect(body.center).toEqual([127.8, 36.5, 7]);
  });

  it('타일: 압축된 그대로(gzip) 보낸다, 없는 칸·범위 밖은 204, 이상한 주소는 400', async () => {
    await put();
    const a = await get('/map/tiles/0/0/0.mvt');
    expect(a.status).toBe(200);
    expect(a.headers.get('Content-Type')).toBe('application/x-protobuf');
    expect(a.headers.get('Content-Encoding')).toBe('gzip');
    expect(a.headers.get('Cache-Control')).toContain('max-age=2592000');
    expect(await unzip(a)).toBe('tile-0-0-0');
    const b = await get('/map/tiles/14/13965/6355.mvt');
    expect(await unzip(b)).toBe('tile-14-13965-6355');
    expect((await get('/map/tiles/14/13965/6356.mvt')).status).toBe(204);
    expect((await get('/map/tiles/15/0/0.mvt')).status).toBe(204);
    expect((await get('/map/tiles/3/9/0.mvt')).status).toBe(400);
    expect((await get('/map/tiles/a/b/c.mvt')).status).toBe(404);
  });

  it('읽은 조각은 Cloudflare 지점 캐시에 두어 다음에는 R2까지 가지 않는다', async () => {
    await put();
    const first = await get('/map/tiles/14/13965/6355.mvt');
    await first.arrayBuffer();
    const again = await get('/map/tiles/14/13965/6355.mvt');
    expect(again.headers.get('X-Map-Cache')).toBe('hit');
    expect(await unzip(again)).toBe('tile-14-13965-6355');
  });

  it('지도 파일을 바꿔도 새 파일로 읽는다 (etag가 달라지면 다시 읽음)', async () => {
    await put();
    expect((await get('/map/tiles/0/0/0.mvt')).status).toBe(200);
    await env.MAP.delete(MAP_KEY);
    await put();
    expect(await unzip(await get('/map/tiles/0/0/0.mvt'))).toBe('tile-0-0-0');
  });

  it('글자 조각: 있으면 그대로, 없으면 404, 범위가 이상하면 400', async () => {
    await env.MAP.put('fonts/Noto Sans Regular/0-255.pbf', new Uint8Array([1, 2, 3]));
    const r = await get('/map/fonts/Noto%20Sans%20Regular/0-255.pbf');
    expect(r.status).toBe(200);
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await get('/map/fonts/Noto%20Sans%20Regular/256-511.pbf')).status).toBe(404);
    expect((await get('/map/fonts/Noto%20Sans%20Regular/1-256.pbf')).status).toBe(400);
    expect((await get('/map/fonts/..%2F..%2Fx/0-255.pbf')).status).toBe(404);
    await env.MAP.delete('fonts/Noto Sans Regular/0-255.pbf');
  });

  it('읽기만 된다. 다른 출처는 403 (앱 주소만)', async () => {
    await put();
    expect((await get('/map/info', { method: 'POST' })).status).toBe(405);
    expect((await get('/map/info', { origin: 'https://example.com' })).status).toBe(403);
    expect((await get('/map/info', { method: 'HEAD' })).status).toBe(200);
    expect((await get('/map/info', { origin: null })).status).toBe(200);
  });
});
