// Worker 바인딩과 설정값
declare namespace Cloudflare {
  interface Env {
    /** R2 버킷 gachitayo-sessions */
    SESSION_FILES: R2Bucket;
    /** https://xxxx.supabase.co */
    SUPABASE_URL: string;
    /** 웹앱 출처 (GitHub Pages): https://{주인}.github.io */
    ALLOWED_ORIGIN: string;
    /** 예전 방식(대칭 키) 프로젝트만: JWT secret */
    SUPABASE_JWT_SECRET?: string;
  }
}
