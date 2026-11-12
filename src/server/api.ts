// 같이타요 API 호출 (Cloudflare Worker, 사양서 6.5·6.6)
import { serverConfig } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(method: string, path: string, opts: { token?: string | null; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${serverConfig.apiUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg;
    } catch {
      // 본문 없음
    }
    throw new ApiError(r.status, msg);
  }
  return (await r.json()) as T;
}
