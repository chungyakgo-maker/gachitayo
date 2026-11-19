/// <reference types="vite/client" />

// vite.config.ts의 define으로 빌드 때 채워지는 값
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

// 빌드 때 넣는 서버(같이타요 API Worker) 주소 (사양서 4장). 없으면 폰에만 저장한다.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** 카카오 JavaScript 키 (그룹 주행 카톡 초대 카드). 공개되는 키라 빌드에 넣는다 */
  readonly VITE_KAKAO_JS_KEY?: string;
  /** 정식 빌드 스위치 (features.ts): 'off'면 지도 위치 공유 끔 */
  readonly VITE_LOCATION_SHARING?: string;
  /** 'off'면 앞 친구·앞 차 간격 끔 (안 적으면 위와 같은 값) */
  readonly VITE_LIVE_GAP?: string;
  /** 'off' 면 바이크 기울기를 예전 계산(속도 × 도는 빠르기)만으로 (features.ts leanFused) */
  readonly VITE_LEAN_FUSED?: string;
}
