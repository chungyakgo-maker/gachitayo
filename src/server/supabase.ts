// Supabase 클라이언트 (익명 로그인, 표). 세션은 폰(localStorage)에 보관하고 토큰은 자동으로 갱신한다.
// 라이브러리가 커서 서버를 쓸 때만 따로 불러온다 (첫 화면을 가볍게).
import type { SupabaseClient } from '@supabase/supabase-js';
import { serverConfig } from './config';

let client: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(serverConfig.supabaseUrl, serverConfig.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'gachitayo.auth' },
    }),
  );
  return client;
}
