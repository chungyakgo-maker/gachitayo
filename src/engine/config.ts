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
    /** GPS 속도가 없는 기기: 이 시간 동안의 GPS 위치가 모여 있으면 정차로 본다 */
    stationaryDerivedWindowS: 4,
    /** GPS 속도가 없는 기기: 이 시간 동안 위치로 직선 맞춤한 속도가 이 값 미만이면 정차 (출발 직후 가속을 정차로 착각하지 않게) */
    stationaryDerivedMaxSpeedMps: 2,
    /** 주행 후 보정: 정차 창 검사 간격 (Motion50 샘플 수) */
    offlineStationaryStep: 25,
    /** 앞 방향: GPS 속도 변화율 하한 */
    forwardMinAccelMps2: 1.5,
    /** 앞 방향: 속도 하한 */
    forwardMinSpeedMps: 2,
    /** 앞 방향: 직진 판단 요레이트 상한 rad/s (약 2.9°/s) */
    forwardMaxYawRate: 0.05,
    /** 앞 방향: 자이로 직진 판단을 이 길이 조각마다 한다 (코너에 걸친 구간 제외) */
    forwardYawPieceS: 0.5,
    /** 앞 방향을 정하는 데 필요한 조건 만족 GPS 구간 수 */
    forwardMinIntervals: 3,
    /** 앞 방향 계산에 쓰는 GPS 앞뒤 간격 상한 (속도 없는 기기는 앞뒤 2점씩이라 2배) */
    forwardMaxGpsSpanMs: 3000,
    /** 재보정: 예상 중력 방향과의 각도 차 */
    recalAngleDeg: 10,
    /** 재보정: 각도 차가 이어져야 하는 시간 */
    recalHoldS: 2,
    /** 재보정 판단에 쓰는 평균 창 */
    recalAvgWindowS: 0.5,
    /** 재보정 판단: 마지막 GPS가 이보다 오래되면 판단하지 않음 */
    recalMaxGpsAgeMs: 1500,
    /** 재보정 판단: 속도 변화율을 구하는 연속 GPS 간격 상한 */
    recalMaxGpsStepMs: 2500,
    /** 재보정 판단 주기 (Motion50 샘플 수, 50 Hz에서 5 = 10 Hz) */
    recalCheckEvery: 5,
    /** 주행 중 재보정 뒤 위 방향: 직선 등속 3초도 정차처럼 쓴다 (M3 결정 '나'). 속도 하한 */
    cruiseMinSpeedMps: 5,
    /** 직선 등속: 연속 GPS 점 사이 속도 변화율 상한 */
    cruiseMaxAccelMps2: 0.3,
    /** 직선 등속: 회전 속도 상한 rad/s (약 1.7°/s) */
    cruiseMaxYawRate: 0.03,
    /** 직선 등속: 가속도 벡터 표준편차 상한 (노면 진동 포함) */
    cruiseAccStdMax: 1.5,
    /** 축 부호 판별: 필요한 회전 구간 수 */
    axisSignMinTurns: 5,
    /** 축 부호 판별: 정규화한 일치도(−1~1)의 절댓값이 이 이상이어야 확정 */
    axisSignMinAgreement: 0.5,
    /** 앞 방향 확인: 이 이상의 GPS 속도 변화율 구간을 쓴다 */
    fwdCheckMinAccelMps2: 1,
    /** 앞 방향 확인: 필요한 구간 수 */
    fwdCheckMinSamples: 5,
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
    /** GPS 방향 값이 없어 위치 이동으로 구한 방향의 표준편차 (코너에서 약 0.5초 늦음) */
    derivedHeadingSigmaDeg: 15,
    /** 이 속도 이상일 때만 GPS 방향을 쓴다 */
    headingMinSpeedMps: 5,
    /** 예측 위치와의 마할라노비스 거리가 이보다 크면 GPS 점을 버린다 */
    outlierSigma: 3,
    /** 연속으로 이만큼 버리면 다음 점으로 위치를 다시 맞춘다 */
    maxConsecutiveRejects: 3,
    /** GPS가 이보다 오래 끊겼다 돌아오면 첫 점은 이상치 검사 없이 받아들인다 */
    noGateAfterGapS: 3,
    /** 과정 잡음 밀도 (단위²/s): 위치, 방향, 속도, 가속도 바이어스 */
    q: {
      imu: { pos: 0.05 ** 2, psi: 0.03 ** 2, v: 0.3 ** 2, b: 0.05 ** 2 },
      imuNoGyro: { pos: 0.05 ** 2, psi: 0.5 ** 2, v: 0.3 ** 2, b: 0.05 ** 2 },
      gpsOnly: { pos: 0.5 ** 2, psi: 0.5 ** 2, v: 3 ** 2, b: 0 },
    },
    /** GPS 속도를 위치 차이로 계산한 점이 이 비율을 넘으면 "속도 품질 낮음" */
    speedQualityLowFraction: 0.2,
    /** 처음 상태의 표준편차 */
    init: { posSigmaM: 5, psiUnknownRad: Math.PI, psiKnownRad: 0.1, vUnknownMps: 3, vKnownMps: 0.5, b: 0.5 },
  },

  /** 코스 (사양서 7.5~7.7) */
  course: {
    /** 중심선 간격 */
    centerlineSpacingM: 1,
    /** 중심선 평활 창 (길이). 너무 크면 헤어핀 안쪽으로 깎인다 */
    centerlineSmoothM: 6,
    gateWidthM: 30,
    sectorFractions: [1 / 3, 2 / 3] as const,
    /** s 검색 범위: 뒤로 */
    sBackWindowM: 20,
    /** s 검색 범위: 앞으로 최소 */
    sFwdWindowMinM: 50,
    /** s 검색 범위: 앞으로 = max(최소, 이 값 × v × dt) */
    sFwdWindowSpeedFactor: 3,
    /** 중심선과의 횡거리가 이보다 크면 코스 이탈 */
    offCourseLateralM: 30,
    /** 같은 게이트를 이 시간 안에 다시 지나면 무시 */
    gateDebounceS: 10,
    /** 첫 주행 자동 생성 */
    auto: {
      startSpeedMps: 3,
      loopMinTravelM: 500,
      loopReturnRadiusM: 30,
      loopHeadingDeg: 45,
      /** 돌아온 뒤 이전 경로와 이 거리 안으로 실제로 겹쳐야 랩 코스로 본다 (헤어핀 옆 다리를 잘못 잇지 않게) */
      loopMatchM: 8,
      /** 처음 돌아온 곳에서 겹치는 지점을 찾는 범위 */
      loopRefineM: 100,
      /** 편도 출발선·도착선을 주행 양 끝에서 이만큼 안쪽에 둔다 (M4 검토 결정) */
      p2pGateInsetM: 20,
    },
    /** GPX(카카오맵 경로 등) 편도 코스 양 끝: 출발·도착 표시에서 도로까지 잇는 짧은 진입로를 건너뛴다 (사용자 요청 "북악 출발선 고쳐").
     *  끝에서 안쪽으로 들어가며 앞으로 windowM 동안 방향이 그 현 방향과 tolDeg 안인 첫 자리. maxTrimM까지 못 찾으면 그대로 */
    gpxEnds: { windowM: 30, tolDeg: 15, maxTrimM: 60 },
    /** 코스 다듬기에 필요한 유효 랩 수 */
    refineMinLaps: 3,
  },

  /** 랩 유효 판정 (사양서 7.8) */
  laps: {
    minCoverage: 0.95,
    distanceTolerance: 0.05,
    maxGpsGapS: 5,
    /** s 덮음 계산 칸 크기 */
    coverageBinM: 5,
  },

  /** 비교용 축약 데이터와 델타 (사양서 6.8, 7.11) */
  delta: {
    stepM: 5,
    updateHz: 10,
    smoothTauS: 0.3,
    /** 위치 표준편차가 이보다 크면 s 신뢰도 낮음 → 델타 숨김 */
    sLowConfidenceSigmaM: 8,
  },

  /** G값 (사양서 7.12) */
  gforce: {
    avgWindowS: 0.2,
    g: 9.80665,
  },

  /** 고도 (사양서 7.13) */
  altitude: {
    /** altAcc가 이보다 크면 뺀다 */
    maxAltAccM: 15,
    /** 평활 창 */
    smoothWindowS: 10,
  },

  /** 처리된 궤적 (사양서 6.7) */
  processed: {
    hz: 10,
  },

  /** GPX */
  gpx: {
    /** GPX에는 정확도가 없어서 이 값으로 둔다 */
    defaultHAccM: 6,
  },

  /** GPS 준비 판정 (사양서 7.4) */
  gpsReady: {
    maxHAccM: 10,
    consecutive: 5,
  },
} as const;
