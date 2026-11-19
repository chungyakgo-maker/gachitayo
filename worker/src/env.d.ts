// Worker 바인딩과 설정값
declare namespace Cloudflare {
  interface Env {
    /** R2 버킷 gachitayo-sessions */
    SESSION_FILES: R2Bucket;
    /** R2 버킷 gachitayo-map-apac(아시아): 선 지도 파일 korea.pmtiles, 글자 조각 fonts/… (GitHub Actions map-data.yml이 올림) */
    MAP: R2Bucket;
    /** D1 데이터베이스 gachitayo */
    DB: D1Database;
    /** 앞 친구 간격용 실시간 방 (사람마다 하나) */
    LIVE: DurableObjectNamespace<import('./live').LiveRoom>;
    /** 그룹 주행 방 (방마다 하나) */
    GROUP: DurableObjectNamespace<import('./group').GroupRoom>;
    /** 웹앱 출처 (GitHub Pages): https://{주인}.github.io */
    ALLOWED_ORIGIN: string;
    /** 카카오 로그인 REST API 키 (GitHub Secrets → 배포 때 Worker 비밀값). 없으면 카카오 로그인을 끈다 */
    KAKAO_REST_API_KEY?: string;
    /** 카카오 로그인 클라이언트 시크릿 */
    KAKAO_CLIENT_SECRET?: string;
    /** 네이버 클라우드 Maps 길찾기(Directions 15) Client ID·Secret (목적지로 주행). 없으면 길찾기를 끈다 */
    NCP_MAP_CLIENT_ID?: string;
    NCP_MAP_CLIENT_SECRET?: string;
    /** 네이버 클라우드 NAVER API HUB 지역 검색 Client ID·Secret (장소 검색). 없으면 검색을 끈다 */
    NAVER_CLIENT_ID?: string;
    NAVER_CLIENT_SECRET?: string;
    /** 애플 로그인 연결 끊기용 (앱 로그인 설계): Sign in with Apple 키(.p8 내용)·키 ID·팀 ID. 없으면 로그인은 되고 끊기만 못 한다 */
    APPLE_SIGNIN_KEY_P8?: string;
    APPLE_SIGNIN_KEY_ID?: string;
    APPLE_TEAM_ID?: string;
    /** 아이폰 앱 번들 ID (없으면 kr.dgo.app) */
    APPLE_BUNDLE_ID?: string;
    /** 관리자 계정 번호 (모두의 코스 관리, 쉼표로 여러 개, GitHub Secrets ADMIN_USER_IDS → 배포 때 Worker 비밀값). 없으면 관리자 없음 */
    ADMIN_USER_IDS?: string;
    /** 테스트에서만: 적용할 D1 마이그레이션 */
    TEST_MIGRATIONS?: import('cloudflare:test').D1Migration[];
  }
}
