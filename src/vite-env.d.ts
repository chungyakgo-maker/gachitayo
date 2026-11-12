/// <reference types="vite/client" />

// vite.config.ts의 define으로 빌드 때 채워지는 값
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

// GitHub Actions 변수에서 빌드 때 넣는 서버 설정 (사양서 4장). 없으면 폰에만 저장한다.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_FILES_API_URL?: string;
}
