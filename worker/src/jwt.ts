// Supabase 액세스 토큰 검증 (사양서 6.6)
// - 비대칭 키(ES256, RS256): 프로젝트 JWKS로 검증. JWKS는 캐시하고, 모르는 키 ID가 오면 다시 받는다(키 교체).
// - 예전 대칭 키(HS256): SUPABASE_JWT_SECRET 비밀값이 있을 때만.
// 만료 시각과 발급자({SUPABASE_URL}/auth/v1)를 확인한다. 통과하면 sub(사용자 ID)를 돌려준다.

export interface Jwk extends JsonWebKey {
  kid?: string;
}
export interface Jwks {
  keys: Jwk[];
}

const JWKS_TTL_MS = 10 * 60 * 1000;
/** 모르는 키 ID로 다시 받는 것은 이 간격에 한 번까지 (잘못된 토큰으로 JWKS를 마구 부르지 않게) */
const JWKS_REFETCH_MIN_MS = 60 * 1000;

let cache: { jwks: Jwks; at: number } | null = null;
let lastForced = -Infinity;

export function resetJwksCache(): void {
  cache = null;
  lastForced = -Infinity;
}

const enc = new TextEncoder();

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parsePart(s: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function getJwks(fetchJwks: () => Promise<Jwks>, now: number, force: boolean): Promise<Jwks> {
  if (cache && !force && now - cache.at < JWKS_TTL_MS) return cache.jwks;
  if (force) lastForced = now;
  const jwks = await fetchJwks();
  cache = { jwks, at: now };
  return jwks;
}

async function verifyWithJwk(alg: string, jwk: Jwk, sig: Uint8Array, data: Uint8Array): Promise<boolean> {
  try {
    if (alg === 'ES256') {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, data);
    }
    if (alg === 'RS256') {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
    }
  } catch {
    return false;
  }
  return false;
}

export async function verifyToken(
  token: string,
  opts: { issuer: string; fetchJwks: () => Promise<Jwks>; hsSecret?: string; now?: number },
): Promise<string | null> {
  const now = opts.now ?? Date.now();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = parsePart(h);
  const claims = parsePart(p);
  if (!header || !claims) return null;
  let sig: Uint8Array;
  try {
    sig = b64urlDecode(s);
  } catch {
    return null;
  }
  const data = enc.encode(`${h}.${p}`);
  const alg = header.alg;
  let ok = false;
  if (alg === 'HS256') {
    if (!opts.hsSecret) return null;
    const key = await crypto.subtle.importKey('raw', enc.encode(opts.hsSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    ok = await crypto.subtle.verify('HMAC', key, sig, data);
  } else if (alg === 'ES256' || alg === 'RS256') {
    const kid = typeof header.kid === 'string' ? header.kid : undefined;
    const pick = (jwks: Jwks) => jwks.keys.filter((k) => (kid ? k.kid === kid : true) && (alg === 'ES256' ? k.kty === 'EC' : k.kty === 'RSA'));
    let jwks: Jwks;
    try {
      jwks = await getJwks(opts.fetchJwks, now, false);
    } catch {
      return null;
    }
    let keys = pick(jwks);
    if (keys.length === 0 && kid && now - lastForced >= JWKS_REFETCH_MIN_MS) {
      try {
        keys = pick(await getJwks(opts.fetchJwks, now, true));
      } catch {
        return null;
      }
    }
    for (const k of keys) {
      if (await verifyWithJwk(alg, k, sig, data)) {
        ok = true;
        break;
      }
    }
  }
  if (!ok) return null;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null;
  if (claims.iss !== opts.issuer) return null;
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
  return claims.sub;
}
