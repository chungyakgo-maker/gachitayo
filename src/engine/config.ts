// 계산 엔진의 모든 숫자 기준값(임계값). 사양서 0장, 7장.
// 값은 초기값이며 실측 후 조정한다. 단위는 이름에 붙인다 (M: m, S: 초, MS: ms, DEG: 도).

export const config = {
  /** 모션 재샘플링 (사양서 6.3) */
  motion: {
    resampleHz: 50,
    /** 이보다 긴 빈 구간은 보간하지 않는다 */
    maxGapMs: 200,
  },

  /** 거치 보정 (사양서 7.2) */
  mount: {
    /** 정차: GPS 속도 미만 */
    stationarySpeedMps: 0.5,
    /** 정차 창 길이 */
    stationaryWindowS: 3,
    /** 정차: 가속도 벡터 표준편차 상한 (진동 포함) */
    stationaryAccStdMax: 0.8,
    /** 정차 창 안에 있어야 하는 GPS fix 수 */
    stationaryMinGpsFixes: 2,
    /** 앞 방향: GPS 속도 변화율 하한 */
    forwardMinAccelMps2: 1.5,
    /** 앞 방향: 속도 하한 */
    forwardMinSpeedMps: 2,
    /** 앞 방향: 직진 판단 요레이트 상한 rad/s (약 2.9°/s) */
    forwardMaxYawRate: 0.05,
    /** 앞 방향을 정하는 데 필요한 조건 만족 GPS 구간 수 */
    forwardMinIntervals: 3,
    /** 앞 방향 계산에 쓰는 GPS 앞뒤 간격 상한 */
    forwardMaxGpsSpanMs: 3000,
    /** 재보정: 예상 중력 방향과의 각도 차 */
    recalAngleDeg: 10,
    /** 재보정: 각도 차가 이어져야 하는 시간 */
    recalHoldS: 2,
    /** 재보정 판단에 쓰는 평균 창 */
    recalAvgWindowS: 0.5,
    /** 재보정 판단: 마지막 GPS가 이보다 오래되면 판단하지 않음 */
    recalMaxGpsAgeMs: 1500,
    /** 축 부호 판별: 필요한 회전 구간 수 */
    axisSignMinTurns: 5,
    /** 축 부호 판별: 회전으로 보는 GPS 방향 변화율 rad/s */
    axisSignMinYawRate: 0.1,
    /** 축 부호 판별: 속도 하한 */
    axisSignMinSpeedMps: 5,
  },

  /** 센서 융합 EKF (사양서 7.3) */
  fusion: {
    /** 격자 간격 (50 Hz) */
    stepMs: 20,
    /** GPS 위치 표준편차(축당) = hAcc × 이 값 (hAcc는 대략 95% 반지름으로 본다) */
    hAccToSigma: 0.5,
    minPosSigmaM: 1,
    /** GPS 속도 표준편차 (높은 가중치) */
    speedSigmaMps: 0.3,
    headingSigmaDeg: 3,
    /** 이 속도 이상일 때만 GPS 방향을 쓴다 */
    headingMinSpeedMps: 5,
    /** 예측 위치와의 마할라노비스 거리가 이보다 크면 GPS 점을 버린다 */
    outlierSigma: 3,
    /** 연속으로 이만큼 버리면 다음 점으로 위치를 다시 맞춘다 */
    maxConsecutiveRejects: 3,
    /** 과정 잡음 밀도 (단위²/s): 위치, 방향, 속도, 가속도 바이어스 */
    q: {
      imu: { pos: 0.05 ** 2, psi: 0.03 ** 2, v: 0.3 ** 2, b: 0.05 ** 2 },
      imuNoGyro: { pos: 0.05 ** 2, psi: 0.5 ** 2, v: 0.3 ** 2, b: 0.05 ** 2 },
      gpsOnly: { pos: 0.5 ** 2, psi: 0.5 ** 2, v: 3 ** 2, b: 0 },
    },
    /** 처음 상태의 표준편차 */
    init: { psiUnknownRad: Math.PI, psiKnownRad: 0.1, vUnknownMps: 3, vKnownMps: 0.5, b: 0.5 },
  },

  /** GPS 준비 판정 (사양서 7.4) */
  gpsReady: {
    maxHAccM: 10,
    consecutive: 5,
  },
} as const;
