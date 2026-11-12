// 계산 엔진의 모든 숫자 기준값(임계값). 사양서 0장, 7장.
// 값은 초기값이며 실측 후 조정한다. 단위는 이름에 붙인다 (M: m, S: 초, MS: ms, DEG: 도).

export const config = {
  /** 모션 재샘플링 (사양서 6.3) */
  motion: {
    resampleHz: 50,
    /** 이보다 긴 빈 구간은 보간하지 않는다 */
    maxGapMs: 200,
  },

  /** GPS 준비 판정 (사양서 7.4) */
  gpsReady: {
    maxHAccM: 10,
    consecutive: 5,
  },
} as const;
