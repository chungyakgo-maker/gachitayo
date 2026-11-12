# M3 계산 엔진 1 (가상 주행, 거치 보정, 센서 융합) — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폰 원본(GPS 1Hz + 기기 축 모션)에서 거치 보정과 센서 융합으로 50Hz 위치·속도·방향을 추정하고, 가상 주행 정답과 비교해 정확도를 숫자로 보인다.

**Architecture:** 모두 순수 TypeScript (`src/engine/**`, `src/normalize/**`, DOM 금지). 가상 주행 생성기(`test/generators/`)가 정답 궤적과 M2 원본과 같은 형식의 `GpsSample[]`·`RawMotionSample[]`을 만든다. 처리 순서: 모션 50Hz 재샘플링 → 플랫폼 부호 적용 → 거치 보정(기기 축→차 축) → EKF(주행 중) → RTS 스무더(주행 후). 실시간과 주행 후는 같은 EKF 코드를 쓴다.

**Tech Stack:** M2 스택. 새 라이브러리 없음 (작은 행렬 연산은 직접 작성).

**Spec:** `docs/specs/2026-11-12-gachitayo-phase1-spec.md` (6.1, 6.2, 6.3, 7.1~7.4, 10.1 가상 주행 생성기)

## Global Constraints

- 모든 임계값은 `src/engine/config.ts` 한 곳에 (초기값, 실측 후 조정)
- 같은 입력이면 항상 같은 출력. 가상 데이터는 시드가 있는 난수
- 좌표: 코스 원점 기준 평면, x 동쪽, y 북쪽, 등장방형 근사 (7.1)
- 차 기준 축: x 앞, y 왼쪽, z 위, 요레이트 좌회전 + (6.2)
- EKF 상태: x, y, ψ(동쪽 기준 반시계 각), v, b(앞 방향 가속도 바이어스) (7.3)
- 관측: GPS 위치(분산은 hAcc로), GPS 속도(있으면 높은 가중치), GPS 방향(v > 5 m/s일 때만). 위치 이상치: 마할라노비스 거리 > 3σ면 버림
- 융합 시각은 GPS 수신 시각 `tRecv` (6.1)
- 거치 보정 (7.2, 사양서 그대로): 정차(GPS 속도 < 0.5 m/s, 가속도 크기 변동 작음) 3초 → 아래 방향 / 직진(요레이트 작음) 중 GPS 속도 변화율 ≥ 1.5 m/s² → 앞 방향 / 왼쪽 = 위 × 앞 / 중력 방향 10° 넘게 2초 이상 바뀌면 재보정 이벤트 후 다시
- 보정 전에는 G값 없음, 융합은 GPS만 모드
- GPS 준비: hAcc ≤ 10 m fix 5개 연속 (7.4)
- GPS 속도가 null이면 위치 차이로 계산하고 "속도 품질 낮음" (6.3)

## 설계 결정 (사양서가 정하지 않은 부분)

- **플랫폼 축 부호:** 아이폰과 안드로이드는 가속도 부호가 반대로 알려져 있다. 정규화에서 `{accelSign, gyroSign}`을 곱하고(기본 +1), 주행 후 처리에서 자동 판별한다. 판별 근거 두 가지: (1) 자이로 요레이트 부호가 GPS 진행 방향 변화율 부호와 같은가 (2) 좌우 가속도가 v × 요레이트와 같은 부호인가. 실기 데이터로 확인 후 기본값 표를 정한다
- **자이로 바이어스:** 정차 구간의 평균 회전 속도를 자이로 바이어스로 빼서 요레이트에 쓴다 (EKF 상태는 사양서대로 5개 유지)
- **재보정 감지:** 0.5초 평균 가속도와 "GPS 속도 변화율·v×요레이트로 예상한 가속도"의 각도 차이로 본다. 긴 브레이크나 긴 코너에서 겉보기 중력이 기우는 것을 거치 변화로 착각하지 않기 위해서다
- **GPS hAcc → 표준편차:** σ(축당) = max(최소 1 m, hAcc × 0.5) (초기값)
- **이상치가 계속되면:** 연속 3번 버려지면 다음 GPS로 위치를 다시 맞춘다 (필터가 틀어져서 모든 GPS를 버리는 상황 방지)
- **원점:** 코스가 없는 M3에서는 세션 첫 GPS 위치

## Review Focus

1. 방향이 ±180°를 넘나드는 경우(서킷 한 바퀴) → 방향 차이·혁신값 각도 정규화
2. GPS가 수십 초 끊겼다가 돌아오는 경우 → 공분산이 커져 다시 받아들이는지 (이상치로 계속 버리지 않는지)
3. 정차만 하고 가속 구간이 없는 기록 → 보정 미완료로 남고, 잘못된 앞 방향을 만들지 않음
4. 자이로가 없는 기기(rotation null) → 요레이트 없이 동작
5. 모션 이벤트가 끊긴 구간(화면 꺼짐 등) → 재샘플링이 끊긴 구간을 보간으로 메우지 않음

---

### Task 1: 가상 주행 생성기

**Files:** Create `test/generators/random.ts`, `test/generators/track.ts`, `test/generators/drive.ts`, `test/generators/sensors.ts`, `test/generators/index.ts`; Test `test/generators/generators.test.ts`

**Interfaces (Produces):**
- `mulberry32(seed): () => number`, `gaussian(rng): number`
- `Track { length; pointAt(s): { x; y; heading /*ψ rad*/; curvature } }`, `ellipseTrack(a, b)`, `segmentTrack(segments: Array<{ straight: number } | { arc: number /*반지름, +왼쪽 −오른쪽*/; angleDeg: number }>)`, `windingWithHairpins()`, `closeParallelTrack()`
- `simulateDrive(track, opts: { laps; startStopS; endStopS; vMax; aLatMax; aAccel; aBrake }): Truth` — `Truth { t: Float64Array; x; y; psi; v; aLong; aLat; yawRate }` (100 Hz)
- `synthesizeSensors(truth, opts: SensorOpts): { gps: GpsSample[]; motion: RawMotionSample[]; mount: Mat3; origin: LatLon }` — `SensorOpts { seed; gpsNoiseM; gpsDriftM; gpsDriftTauS; outlierRate; dropouts: Array<[startS, endS]>; speedNull; headingNull; mountEulerDeg: [yaw, pitch, roll]; accelSign; gyroSign; accelNoise; accelBias; gyroNoise; gyroBias; motionHz; motionJitterMs; motionGaps: Array<[startS, endS]>; noGyro }`

- [ ] 테스트: 타원 길이 ≈ 라마누잔 근사 (0.1%) / 정답 aLat ≈ v²·곡률, yawRate ≈ v·곡률 / 속도 프로필이 가속·제동 한계를 넘지 않음 / GPS 잡음 RMS가 설정값 근처 / 끊김 구간에 GPS 없음 / 모션을 정답 거치 행렬로 되돌리면 차 축 가속도와 같음 / 같은 시드면 같은 결과
- [ ] FAIL → 구현 → PASS → 커밋

### Task 2: 기준값, 지역 좌표, 재샘플링, GPS 준비, GPS 관측 준비

**Files:** Create `src/engine/config.ts`(채우기), `src/engine/geo.ts`, `src/engine/linalg.ts`, `src/normalize/resample.ts`, `src/engine/fusion/gpsReady.ts`, `src/engine/fusion/gpsObs.ts`; Test `test/engine/geo.test.ts`, `test/normalize/resample.test.ts`, `test/engine/gpsReady.test.ts`, `test/engine/gpsObs.test.ts`

**Interfaces (Produces):**
- `LatLon { lat; lon }`, `toLocal(origin, lat, lon): { x; y }`, `fromLocal(origin, x, y): LatLon`
- `Vec3 = [number, number, number]`, `Mat3`(행 우선 9개), `dot`, `cross`, `norm`, `normalize`, `matVec`, `angleBetween`
- `Motion50 { t0; dt; n; fx; fy; fz; wx; wy; wz: Float64Array; valid: Uint8Array; hasGyro: boolean }`, `resampleMotion(samples, signs?: { accel: 1 | -1; gyro: 1 | -1 }): Motion50`
- `GpsReadiness`: `push(s): boolean`(준비 여부), `ready`
- `GpsObs { t /*tRecv*/; x; y; hAcc; speed: number | null; speedDerived: boolean; psi: number | null }`, `prepareGps(gps, origin): GpsObs[]`, `gpsPsiFromHeading(deg): number`

- [ ] 테스트: 좌표 왕복 오차 < 1 mm, 1 km 거리 오차 < 0.1% / 60Hz 불규칙 → 50Hz 선형 보간 정확, 200 ms 넘는 빈 구간은 valid 0, 부호 적용 / 준비: 10 m 이하 5개 연속이면 준비, 중간에 나쁜 값이면 다시 셈 / 속도 null이면 위치 차이로 계산하고 derived 표시, 방향 0°(북)→ψ π/2, 90°(동)→ψ 0
- [ ] FAIL → 구현 → PASS → 커밋

### Task 3: 거치 보정

**Files:** Create `src/normalize/mount.ts`; Test `test/normalize/mount.test.ts`

**Interfaces:**
- Consumes: `Motion50`, `GpsObs`
- Produces:
  - `MountCalibration { R: Mat3 /*행: 앞, 왼쪽, 위*/; gravity; gyroBias: Vec3; tCalibrated }`
  - `toCar(cal, f, w): { ax; ay; az; yawRate }`
  - `MountCalibrator` (실시간): `pushMotion(i)`(Motion50 인덱스), `pushGps(obs)`, `state: 'need_stationary' | 'need_forward' | 'calibrated'`, `current: MountCalibration | null`, `events: Array<{ t; type: 'calibration' | 'recalibration' }>`
  - `calibrateSession(m50, gpsObs): { segments: Array<{ tStart; tEnd; cal: MountCalibration | null }>; events }` (주행 후: 거치가 바뀐 지점에서 나누어 구간마다 전체 데이터로 다시 계산)
  - `detectAxisSigns(m50, gpsObs, cal): { accel: 1 | -1; gyro: 1 | -1; confidence: 'high' | 'low' }`

- [ ] 테스트: 임의 거치 각도 5가지에서 복원 각도 오차 < 2° (위 방향 < 1°) / 정차만 있고 가속 구간이 없으면 `need_forward`에 머묾 / 주행 중 거치를 20° 돌리면 3초 안에 재보정 이벤트, 다음 정차 뒤 새 각도 오차 < 2° / 긴 브레이크(0.8 g, 3초)와 긴 코너에서는 재보정 이벤트 없음 / 가속도 부호 뒤집힘·자이로 부호 뒤집힘을 판별 / 차 축 변환 후 ax, ay가 정답과 RMS < 0.3 m/s²
- [ ] FAIL → 구현 → PASS → 커밋

### Task 4: EKF (주행 중 필터)

**Files:** Create `src/engine/fusion/ekf.ts`, `src/engine/fusion/forward.ts`; Test `test/engine/ekf.test.ts`, `test/engine/forward.test.ts`

**Interfaces (Produces):**
- `CarEkf`: `init(x, y, psi, v)`, `predict(ax, yawRate, dt, mode: 'imu' | 'gps_only')`, `updatePosition(x, y, sigma): 'accepted' | 'rejected'`, `updateSpeed(v, sigma)`, `updateHeading(psi, sigma)`, `state(): Float64Array(5)`, `cov(): Float64Array(25)`, `positionSigma()`
- `FusionRunner` (실시간·주행 후 공용): `constructor(opts: { m50; calibration: (t) => MountCalibration | null; record?: boolean })`, `runTo(t)`, `pushGps(obs)`, `current(): FusedPoint`, `history` (record일 때 RTS용 기록)
- `FusedPoint { t; x; y; psi; v; sigmaPos; mode }`

- [ ] 테스트: 직선 등속에서 GPS만으로 수렴 / ψ가 +π→−π를 넘어도 연속 / 50 m 튀는 점은 버리고 추정이 2 m 넘게 움직이지 않음 / 30초 끊긴 뒤 돌아온 GPS는 받아들임 / 가상 서킷에서 필터 위치 RMS < GPS 원본 RMS × 0.8, 속도 RMS < 0.5 m/s / 3초 끊김 중 최대 위치 오차 < 5 m, 8초 < 15 m / 모션 없음(GPS만 모드)에서도 위치 RMS < GPS 원본 RMS / 자이로 없음에서 동작
- [ ] FAIL → 구현 → PASS → 커밋

### Task 5: RTS 스무더와 세션 처리

**Files:** Create `src/engine/fusion/smoother.ts`, `src/engine/fusion/processSession.ts`; Test `test/engine/smoother.test.ts`

**Interfaces (Produces):**
- `rtsSmooth(history): SmoothedTrack` — `SmoothedTrack { t0; dt; n; x; y; psi; v: Float64Array }`
- `processSession(input: { gps: GpsSample[]; motion: RawMotionSample[]; origin?: LatLon }): { origin; track: SmoothedTrack; filtered: SmoothedTrack; calibration; axisSigns; speedQualityLow: boolean; gpsOnly: boolean }`

- [ ] 테스트: 스무더 위치 RMS < 필터 위치 RMS, 속도 RMS < 필터 / 8초 끊김 구간 최대 오차가 필터보다 작음 / ψ 연속 / 가상 서킷 스무더 위치 RMS < 2 m, 속도 RMS < 0.3 m/s (초기 목표, 측정 후 조정)
- [ ] FAIL → 구현 → PASS → 커밋

### 마무리

- [ ] 정확도 보고 표(시나리오별: GPS 원본·필터·스무더의 위치·속도 RMS, 최대 오차, 거치 각도 오차)와 궤적 비교 그림(SVG→PNG) 생성 — `test/report/fusionReport.test.ts` (`REPORT=1`일 때만 실행)
- [ ] main 푸시 → Actions 통과
