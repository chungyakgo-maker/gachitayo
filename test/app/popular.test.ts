// 인기 도로 불러오기: 기간마다 1분 동안은 다시 묻지 않는다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/app/account', () => ({ getAuth: () => ({ userId: 'u1', token: 'tok' }) }));
const urls: string[] = [];
beforeEach(() => {
  urls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) => {
      urls.push(u);
      return new Response(JSON.stringify([{ builtin: 'haogogae', drivers: 3 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
const { fetchPopular } = await import('../../src/app/popular');

describe('fetchPopular', () => {
  it('asks the server per period and reuses it for a minute', async () => {
    expect(await fetchPopular('30d', 1_000)).toEqual([{ builtin: 'haogogae', drivers: 3 }]);
    expect(urls.at(-1)).toMatch(/\/api\/popular\?period=30d$/);
    await fetchPopular('30d', 30_000);
    expect(urls).toHaveLength(1);
    await fetchPopular('live', 30_000);
    expect(urls).toHaveLength(2);
    await fetchPopular('30d', 62_000);
    expect(urls).toHaveLength(3);
  });
});
