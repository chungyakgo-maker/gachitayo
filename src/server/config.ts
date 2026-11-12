// 서버 주소 (GitHub Actions가 Worker를 배포한 뒤 빌드에 넣는다). 아직 없으면 서버 기능을 끈다 (폰에만 저장).
export const serverConfig = {
  apiUrl: (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/$/, ''),
};

/** 계정(익명)을 만들 수 있는지 */
export const accountEnabled = (): boolean => serverConfig.apiUrl !== '';
/** 업로드할 수 있는지 */
export const uploadEnabled = (): boolean => accountEnabled();
