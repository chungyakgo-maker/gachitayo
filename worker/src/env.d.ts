// Worker 바인딩과 설정값
declare namespace Cloudflare {
  interface Env {
    /** R2 버킷 gachitayo-sessions */
    SESSION_FILES: R2Bucket;
    /** D1 데이터베이스 gachitayo */
    DB: D1Database;
    /** 웹앱 출처 (GitHub Pages): https://{주인}.github.io */
    ALLOWED_ORIGIN: string;
    /** 테스트에서만: 적용할 D1 마이그레이션 */
    TEST_MIGRATIONS?: import('cloudflare:test').D1Migration[];
  }
}
