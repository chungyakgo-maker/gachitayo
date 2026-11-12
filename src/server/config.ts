// 서버 설정값 (GitHub Actions 변수 → 빌드). 아직 등록하지 않았으면 서버 기능을 끈다 (폰에만 저장).
const env = import.meta.env;

export const serverConfig = {
  supabaseUrl: (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/$/, ''),
  anonKey: (env.VITE_SUPABASE_ANON_KEY ?? '').trim(),
  filesUrl: (env.VITE_FILES_API_URL ?? '').trim().replace(/\/$/, ''),
};

/** Supabase(계정·표)를 쓸 수 있는지 */
export const accountEnabled = (): boolean => serverConfig.supabaseUrl !== '' && serverConfig.anonKey !== '';
/** 업로드(파일 게이트웨이까지)를 할 수 있는지 */
export const uploadEnabled = (): boolean => accountEnabled() && serverConfig.filesUrl !== '';
