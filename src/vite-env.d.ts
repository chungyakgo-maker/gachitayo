/// <reference types="vite/client" />

// vite.config.ts의 define으로 빌드 때 채워지는 값
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

// 빌드 때 넣는 서버(같이타요 API Worker) 주소 (사양서 4장). 없으면 폰에만 저장한다.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}
