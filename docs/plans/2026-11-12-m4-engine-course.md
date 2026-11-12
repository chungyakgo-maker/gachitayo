# M4 계산 엔진 2 (코스, 랩, 델타, GPX) — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 융합 궤적에서 코스 거리 s, 게이트 통과, 랩·구간·유효 판정, 이론상 베스트, 비교용 축약 데이터, 델타, G값, 고도를 계산하고, 첫 주행 자동 코스 생성·코스 다듬기·선 옮기기·GPX 변환을 순수 TypeScript로 만든다. 주행 후 처리와 주행 중 처리를 모두 제공한다.

**Architecture:** 모두 `src/engine/**`, `src/gpx/**` (DOM 금지). 코스는 저장 형식(위경도, 사양서 6.5)과 계산 형식(코스 원점 기준 평면 좌표)을 나눈다. 주행 후: `processDrive(원본, 코스?)` → M3 `processSession` → 코스가 없으면 자동 생성 제안 → 게이트·s·랩·구간·trace·처리된 궤적. 주행 중: `LiveEngine.push(융합 점)` → 화면 상태(델타, 랩, 구간, 속도, G, 상태 표시).

**Tech Stack:** M3 스택. 새 라이브러리 없음 (GPX용 작은 XML 파서를 직접 작성해 기본값으로 주입).

**Spec:** `docs/specs/2026-11-12-gachitayo-phase1-spec.md` (5.4, 6.5 courses·laps, 6.7 처리된 궤적, 6.8, 7.5~7.13, 8.7 GPX, 10.1)

## Global Constraints

- 모든 임계값은 `src/engine/config.ts`에 (초기값)
- 코스 원점 기준 평면 좌표 (7.1), 중심선 1 m 간격, 게이트 기본 폭 30 m, 구간 경계 = 길이의 1/3, 2/3
- s 검색 범위 [s_prev − 20 m, s_prev + max(50 m, 3·v·dt)], 횡거리 30 m 초과면 코스 이탈(s 정지, 델타 숨김), 출발 게이트 통과 시 s = 0 (7.6)
- 게이트 통과: 연속 두 융합 위치 선분과 게이트 선분 교차 + 진행 방향 내적 > 0, 시각은 선분 안 선형 보간, 같은 게이트 10초 안 재통과 무시 (7.7)
- 랩 유효: s 진행 95% 이상 덮음, 이동 거리 코스 길이 ±5%, GPS 5초 넘게 끊김 없음, 코스 이탈 없음 (+ 사양서 9장: 중단 구간이 걸친 랩 무효) (7.8)
- trace: 코스 거리 5 m 격자 `{ stepM: 5, t, v, alt }`, t는 랩 시작부터 초(소수 3자리) (6.8)
- 델타 = 현재 랩 경과 − t_ref(s), + 느림, 10 Hz, 시간 상수 0.3초 지수 평활, 소수 둘째 자리, 숨김: 코스 이탈·GPS 끊김·s 신뢰도 낮음(위치 σ > 8 m)·비교 랩 없음 (7.11)
- G: 차 기준 ax, ay 0.2초 이동평균, g = 9.80665 (7.12)
- 고도: altAcc 큰 점 제외 후 평활 (7.13)
- 처리된 궤적 10 Hz 열: t, lat, lon, alt, speed, heading, ax, ay, s, lapNo (6.7)

## 결정 사항 (사용자 확인: 추천대로)

- **첫 주행 랩 코스 판정 (질문 3):** 500 m 이상 달린 뒤 이전에 지났던 어느 지점이든 30 m 이내·방향 차 45° 이내로 다시 지나면 랩 코스. 출발선은 처음 다시 지난 곳에서 가장 가까운 이전 지점(피트 출발이어도 트랙 위). 진행 방향 = 그 지점의 방향.
- **편도 (질문 4):** 출발선 = 처음 3 m/s를 넘은 지점. 도착선 = 끝나기 전 마지막 3 m/s 이상 지점, 단 그 점이 출발점 30 m 안이면(왕복) 출발점에서 직선거리로 가장 먼 지점. 한 세션에서 출발→도착을 지날 때마다 1랩(반대 방향 통과는 게이트 방향 검사로 무시).
- **선 옮기기 (질문 5):** 게이트는 중심선 위로만 옮긴다(가장 가까운 중심선 위치로 붙임). 랩 코스는 중심선 시작을 새 출발선으로 돌리고, 편도는 출발 앞·도착 뒤를 잘라낸다. version +1. 기존 기록 재계산은 같은 `processDrive`로 한다(화면 연결은 M7).
- **재보정 (M3 질문):** 직선 등속 3초도 정차처럼 인정 — M5 실시간 연결 때 반영(M4 범위 아님, 기록만).
- **GPX XML 파서:** 사양서대로 주입받되, 기본값으로 순수 TS 작은 파서를 둔다(브라우저 DOMParser 없이 Node 테스트 가능).

## Review Focus

1. 헤어핀·평행 구간에서 s가 옆 구간으로 튐 → 검색 범위로 막는지
2. 출발선 근처에서 멈췄다 다시 출발(같은 게이트 여러 번 통과) → 10초 재통과 무시, 방향 검사
3. 랩 코스에서 s가 둘레를 넘어갈 때(마지막 몇 m) → 다음 랩 0으로 이어짐, trace 끝점
4. GPS가 출발선 바로 앞에서 끊김 → 그 랩 무효, 다음 게이트부터 정상
5. GPX에 시간 없음·이름공간 접두사 다름·`rte`만 있음·빈 파일 → 오류 없이 처리하거나 분명한 오류

---

### Task 1: 코스 형식과 기하 (중심선, 게이트, s 추적)

**Files:** Create `src/types/course.ts`, `src/engine/course/polyline.ts`, `src/engine/course/geometry.ts`, `src/engine/course/sTracker.ts`; Modify `src/engine/config.ts`; Test `test/engine/course/geometry.test.ts`, `test/engine/course/sTracker.test.ts`

**Interfaces (Produces):**
- `Gate { lat; lon; bearingDeg; widthM }`, `CourseKind = 'loop' | 'point_to_point'`, `Course { id; name; kind; source: 'auto' | 'map' | 'gpx'; origin: LatLon; startGate; finishGate; centerline: Array<[number, number]> | null; lengthM: number | null; sectorBoundsM: [number, number] | null; version }`
- `Polyline { x; y; s: Float64Array; length }`, `smoothPath(xs, ys, windowM)`, `resamplePolyline(p, spacingM)`, `polylinePoint(p, s): { x; y; psi }`
- `CourseGeometry { course; centerline: Polyline | null; start: GateSegment; finish: GateSegment; sectorBounds: [number, number] | null }`, `GateSegment { cx; cy; dx; dy /*진행 방향 단위벡터*/; ax; ay; bx; by }`, `buildGeometry(course)`, `centerlineToLatLon(p, origin)`
- `STracker(geom)`: `update(x, y, v, t): { s: number | null; lateral: number; onCourse: boolean }`, `resetAtStart()`

- [ ] 테스트: 1 m 재샘플 간격 / 평활 후 길이 변화 < 0.5% / 게이트 선분 방향 / 헤어핀·20 m 평행 코스에서 정답 궤적을 따라가면 s가 앞으로만(뒤로 2 m 초과 없음), 한 번에 v·dt+5 m 넘게 튀지 않음 / 40 m 벗어나면 이탈·s 정지, 돌아오면 이어짐 / 랩 코스에서 둘레 넘으면 이어짐
- [ ] FAIL → 구현 → PASS → 커밋

### Task 2: 게이트 통과, 랩·구간·유효 판정, 이론상 베스트

**Files:** Create `src/engine/course/gates.ts`, `src/engine/course/laps.ts`; Test `test/engine/course/laps.test.ts`

**Interfaces (Produces):**
- `crossGate(p0, p1, gate): number | null`(선분 안 비율 0~1), `GateDetector(geom)`: `push(t, x, y): Array<{ gate: 'start' | 'finish'; t }>` (10초 재통과 무시)
- `LapResult { lapNo; startT; endT; lapTimeMs; sectorTimesMs: [number|null, number|null, number|null]; valid; invalidReason: 'coverage' | 'distance' | 'gps_lost' | 'off_course' | 'interrupted' | null; maxSpeed; distanceM }`
- `splitLaps(input: { geom; track: { t; x; y; v: Float64Array; n }; gpsTimes: number[]; pauses: Array<[number, number]> }): { laps: LapResult[]; frameS: Float64Array; frameLap: Int32Array; offCourse: Uint8Array }`
- `theoreticalBest(laps): { sectors: [number, number, number] | null; totalMs: number | null }`

- [ ] 테스트: 게이트 교차 비율·방향 / 10초 안 재통과 무시 / 가상 오벌 4바퀴(정답에서 만든 코스): 랩타임 오차 ≤ 0.1초, 게이트 통과 시각 오차 RMS ≤ 0.05초 / 구간 기록 합 = 랩타임 / 8초 끊긴 랩만 무효('gps_lost') / 이탈 구간 랩 무효 / 이동 거리 10% 긴 랩 무효('distance') / 중단 구간 랩 무효 / 편도 왕복 세션: 올라가는 방향만 랩 / 이론상 베스트 = 구간 최소 합
- [ ] FAIL → 구현 → PASS → 커밋

### Task 3: 자동 코스 생성, 코스 다듬기, 선 옮기기

**Files:** Create `src/engine/course/autoCourse.ts`, `src/engine/course/edit.ts`; Modify `test/generators/track.ts`, `test/generators/drive.ts`; Test `test/engine/course/autoCourse.test.ts`, `test/engine/course/edit.test.ts`

**Interfaces (Produces):**
- 생성기: `concatTracks(lead, loop, laps)`(진입로 + 바퀴), `reversedTrack(t)`, `DriveOpts.stops: Array<{ s; durationS }>`
- `detectCourse(track, origin): { kind; startGate; finishGate; centerline: Polyline; lapRange: [tStart, tEnd] } | null`
- `courseFromCenterline(...)`, `refineCourse(course, lapPaths): Course`(유효 랩 3개 이상, version +1), `moveGate(course, which, x, y): Course`(중심선에 붙이고 version +1)

- [ ] 테스트: 트랙 위 출발 오벌 → 랩 코스, 출발선이 출발점 근처 / 피트(진입로) 출발 → 랩 코스, 출발선이 트랙 위(진입로 아님) / 편도 한 번 → 편도, 출발·도착 위치 / 편도 왕복 → 도착선이 돌아선 지점 근처 / 다듬기: 잡음 있는 3랩 평균이 1랩보다 정답에 가깝고 version +1 / 선 옮기기: 중심선 위로 붙고 랩 코스 중심선 시작이 새 위치, 편도는 잘림, version +1
- [ ] FAIL → 구현 → PASS → 커밋

### Task 4: trace, 델타, G값, 고도

**Files:** Create `src/engine/delta/trace.ts`, `src/engine/delta/delta.ts`, `src/engine/derive/gforce.ts`, `src/engine/derive/altitude.ts`; Test `test/engine/delta.test.ts`, `test/engine/derive.test.ts`

**Interfaces (Produces):**
- `LapTrace { stepM: 5; t: number[]; v: number[]; alt: number[] }`, `buildTrace(lap frames): LapTrace`, `refTimeAt(trace, s, lapTimeMs): number`
- `DeltaFilter`: `push(tMs, deltaRaw | null): { delta: number | null }` (10 Hz, τ 0.3초, 숨김이면 null·필터 초기화)
- `movingAverageG(ax, ay, hz): { gx; gy }`(0.2초, g 단위), `smoothAltitude(gps, times): Float64Array`

- [ ] 테스트: trace 격자 5 m·첫 t 0·단조 증가·소수 3자리 / 같은 랩끼리 델타 0 / 3% 느린 랩의 끝 델타 ≈ 랩타임 차(±0.05초) / 평활: 0→1 계단 입력이 0.3초 뒤 1−e⁻¹ / 숨김이면 null / G: 0.2초 평균·g 단위 / 고도: altAcc 큰 점 제외
- [ ] FAIL → 구현 → PASS → 커밋

### Task 5: 주행 후 처리와 주행 중 엔진

**Files:** Create `src/engine/process/processDrive.ts`, `src/engine/live/liveEngine.ts`; Test `test/engine/processDrive.test.ts`, `test/engine/liveEngine.test.ts`

**Interfaces (Produces):**
- `processDrive(input: { gps; motion; events; course: Course | null; refTrace?: LapTrace | null }): DriveResult` — `DriveResult { proposedCourse: Course | null; laps: Array<LapResult & { trace: LapTrace }>; theoreticalBest; processed: ProcessedTrack; summary; fusion 메타(axisSigns, speedQualityLow, gpsOnly) }`, `ProcessedTrack { hz: 10; t; lat; lon; alt; speed; heading; ax; ay: (number|null)[]; s; lapNo }`
- `LiveEngine(course geometry | null, ref trace | null)`: `push(p: FusedPoint & { ax?; ay?; gpsOk; gCalibrated }): LiveState`, `LiveState { t; speedKmh; lapNo; lapElapsedMs; lastLap: { lapNo; timeMs } | null; bestLapMs; sectorTimesMs; delta: number | null; s: number | null; onCourse; gx; gy: number | null; status: { gpsWeak; offCourse; gNotCalibrated } }`

- [ ] 테스트(가상 주행 끝에서 끝까지): 첫 세션(코스 없음) → 랩 코스 제안, 랩·구간·trace / 두 번째 세션(그 코스, 3% 느림) → 주행 중 델타가 정답 델타와 RMS < 0.1초 / 처리된 궤적 10 Hz, 열 길이 같음 / 주행 중 엔진: 첫 주행(비교 랩 없음)은 델타 null, 랩 통과 시 lastLap
- [ ] FAIL → 구현 → PASS → 커밋

### Task 6: GPX 불러오기·내보내기

**Files:** Create `src/gpx/xml.ts`, `src/gpx/parse.ts`, `src/gpx/export.ts`, `src/gpx/course.ts`; Test `test/gpx/gpx.test.ts`, `test/fixtures/gpx/*.gpx`

**Interfaces (Produces):**
- `parseXml(text): XmlNode`, `parseGpx(text, parser = parseXml): { name; points: GpxPoint[]; hasTime: boolean; source: 'trk' | 'rte' }`, `GpxPoint { lat; lon; ele: number | null; time: number | null; speed: number | null }`
- `courseFromGpx(gpx, name): Course`(평활·1 m, 양 끝 30 m 이내면 랩), `gpsSamplesFromGpx(gpx): GpsSample[]`
- `courseToGpx(course): string`, `sessionToGpx(name, startedAt, gps): string`

- [ ] 테스트: trk 우선·없으면 rte / 시간 있는·없는 GPX / 가민 TrackPointExtension 속도, GPX 1.0 `<speed>` / 이름공간 접두사가 달라도 읽음 / 빈 파일·잘못된 XML은 분명한 오류 / 코스 왕복: 내보낸 뒤 불러오면 중심선 0.1 m 안·종류·게이트 같음 / 세션 왕복: 내보낸 뒤 불러오면 같은 샘플, 같은 처리 결과
- [ ] FAIL → 구현 → PASS → 커밋

### 마무리

- [ ] 10.1 검증 항목 결과 표 (랩타임·델타·게이트·s·무효·GPX), main 푸시 → Actions 통과
