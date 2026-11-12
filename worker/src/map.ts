// 선 지도 (사양서 8.9, 사용자 요청): R2 gachitayo-map-apac(아시아) 버킷의 한국 지도 파일(korea.pmtiles, Protomaps 기반 OSM 벡터 타일)에서
// 앱이 필요한 조각만 꺼내 준다. 글꼴 조각(fonts/…)도 같은 버킷. 지도 데이터는 GitHub Actions(map-data.yml)가 올린다.
//   GET /map/info                         지도 파일 정보 (확대 범위·영역). 없으면 404 → 앱은 예전 사진 지도로
//   GET /map/tiles/{z}/{x}/{y}.mvt        벡터 타일 (없는 칸은 204)
//   GET /map/fonts/{글꼴}/{시작}-{끝}.pbf  지도 글자 조각 (한글은 앱이 폰 글꼴로 그린다)
import { Compression, EtagMismatch, findTile, PMTiles, ResolvedValueCache, zxyToTileId, type RangeResponse, type Source } from 'pmtiles';
import { HttpError, json } from './http';

export const MAP_KEY = 'korea.pmtiles';

/** R2에서 범위로 읽는 지도 파일. 파일이 바뀌면(etag 다름) 라이브러리가 머리·목록을 다시 읽는다 */
class R2Source implements Source {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
  ) {}
  getKey(): string {
    return this.key;
  }
  async getBytes(offset: number, length: number, _signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.key, { range: { offset, length }, onlyIf: etag ? { etagMatches: etag } : undefined });
    if (!obj) throw new HttpError(404, '지도 데이터가 아직 없어요');
    if (!('body' in obj)) throw new EtagMismatch();
    return { data: await obj.arrayBuffer(), etag: obj.etag };
  }
}

// 같은 Worker 안에서 머리·목록을 다시 읽지 않게 (요청 사이에 남는다)
const CACHE = new ResolvedValueCache(64, undefined);

function archive(env: Cloudflare.Env): PMTiles {
  return new PMTiles(new R2Source(env.MAP, MAP_KEY), CACHE);
}

/**
 * 조각을 압축된 그대로 찾는다 (사용자 요청 "지도 로딩이 느리다": 풀어서 보내면 2~3배 무겁고 Worker도 일을 더 한다).
 * 목록(디렉터리)만 풀어 읽고, 조각은 R2에서 꺼낸 바이트 그대로.
 */
async function rawTile(env: Cloudflare.Env, z: number, x: number, y: number): Promise<{ data: ArrayBuffer; gzip: boolean } | null> {
  const source = new R2Source(env.MAP, MAP_KEY);
  const h = await CACHE.getHeader(source);
  if (z < h.minZoom || z > h.maxZoom) return null;
  const id = zxyToTileId(z, x, y);
  let offset = h.rootDirectoryOffset;
  let length = h.rootDirectoryLength;
  for (let depth = 0; depth <= 3; depth++) {
    const dir = await CACHE.getDirectory(source, offset, length, h);
    const e = findTile(dir, id);
    if (!e) return null;
    if (e.runLength > 0) {
      const r = await source.getBytes(h.tileDataOffset + e.offset, e.length, undefined, h.etag);
      return { data: r.data, gzip: h.tileCompression === Compression.Gzip };
    }
    offset = h.leafDirectoryOffset + e.offset;
    length = e.length;
  }
  return null;
}

const TILE_RE = /^\/map\/tiles\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.mvt$/;
const FONT_RE = /^\/map\/fonts\/([A-Za-z0-9 ]{1,40})\/(\d{1,5})-(\d{1,5})\.pbf$/;

export async function handleMap(req: Request, env: Cloudflare.Env, path: string, headers: Headers): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405);
  const head = req.method === 'HEAD';

  if (path === '/map/info') {
    const h = await archive(env).getHeader();
    headers.set('Cache-Control', 'public, max-age=300');
    return json(200, headers, {
      minZoom: h.minZoom,
      maxZoom: h.maxZoom,
      bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
      center: [h.centerLon, h.centerLat, h.centerZoom],
      etag: h.etag ?? null,
    });
  }

  const tile = TILE_RE.exec(path);
  if (tile) {
    const [z, x, y] = [Number(tile[1]), Number(tile[2]), Number(tile[3])];
    if (z > 22 || x >= 2 ** z || y >= 2 ** z) throw new HttpError(400, '잘못된 타일');
    // 폰이 30일 보관 (지도 데이터는 한 달에 한 번 바뀐다)
    headers.set('Cache-Control', 'public, max-age=2592000');
    const r = await rawTile(env, z, x, y);
    if (!r) return new Response(null, { status: 204, headers });
    headers.set('Content-Type', 'application/x-protobuf');
    if (r.gzip) headers.set('Content-Encoding', 'gzip');
    // 이미 압축된 바이트를 그대로 보낸다 (런타임이 다시 압축하지 않게)
    return new Response(head ? null : r.data, { status: 200, headers, encodeBody: 'manual' });
  }

  // 글꼴 이름의 빈칸은 %20으로 온다. 풀어서 맞춰 본다 (/, . 같은 글자는 위 식이 받지 않는다)
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new HttpError(400, '잘못된 주소');
  }
  const font = FONT_RE.exec(decoded);
  if (font) {
    const [start, end] = [Number(font[2]), Number(font[3])];
    if (start % 256 !== 0 || end !== start + 255 || end > 65535) throw new HttpError(400, '잘못된 글자 범위');
    const obj = await env.MAP.get(`fonts/${font[1]}/${start}-${end}.pbf`);
    if (!obj) throw new HttpError(404, '글자 조각이 없어요');
    headers.set('Content-Type', 'application/x-protobuf');
    headers.set('Cache-Control', 'public, max-age=604800');
    return new Response(head ? null : obj.body, { status: 200, headers });
  }

  throw new HttpError(404, '없음');
}
