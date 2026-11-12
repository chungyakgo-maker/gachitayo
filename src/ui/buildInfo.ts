// 빌드 정보. 새 배포가 폰에 반영됐는지 화면에서 확인하는 용도.
export const buildInfo = {
  /** 커밋 앞 7자리, GitHub Actions 밖에서 빌드하면 'local' */
  version: __APP_VERSION__,
  /** 빌드 시각 (ISO) */
  builtAt: __BUILD_TIME__,
} as const;
