// 하루 사용 횟수 (길찾기·장소 검색): 계정·한국 날짜·횟수만 센다. 부르기 전에 1 올리고 한도를 넘으면 429
import { HttpError } from './http';

/** 한국 날짜 (YYYY-MM-DD) */
export const kstDay = (now: number): string => new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);

export async function countUsage(env: Cloudflare.Env, table: 'route_usage' | 'search_usage', userId: string, now: number, limit: number, message: string): Promise<void> {
  const row = await env.DB.prepare(`INSERT INTO ${table} (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 RETURNING count`)
    .bind(userId, kstDay(now))
    .first<{ count: number }>();
  if ((row?.count ?? 0) > limit) throw new HttpError(429, message);
}
