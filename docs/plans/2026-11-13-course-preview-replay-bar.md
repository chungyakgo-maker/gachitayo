# 모의주행 + 재생 막대 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코스 상세에서 "모의주행 (코스 미리 보기)"을 누르면 가상 차가 그 코스를 한 번 달리는 것을 주행 화면에 보여 주고, 재생(모의주행·저장된 기록·가상 오벌)에는 끌어서 옮기는 재생 막대를 둔다.

**Architecture:** 코스 중심선으로 가상 코스(`sim/Track`)를 만들어 기존 가상 주행·가상 센서(`sim/`)로 GPS·모션을 만든다. 재생은 시작할 때 `LivePipeline`을 끝까지 한 번 돌려 0.1초마다의 스냅숏을 저장(`ReplayTimeline`)하고, 재생·막대 이동은 그 배열에서 꺼내 `publish`한다. 지나온 길 배열은 프레임마다 복사하지 않고 공용 기록 + 인덱스로 둔다.

**Tech Stack:** TypeScript strict, React 19, Vitest(core: node, ui: jsdom), 기존 `src/sim`, `src/engine/live/livePipeline.ts`, `src/app/drive.ts`.

**Spec:** `docs/specs/2026-11-12-gachitayo-phase1-spec.md` 10.2(모의주행·재생 막대), 8.7(코스 상세), 변경 이력 2026-11-13.

## Global Constraints

- 모든 화면 글·주석·커밋은 한국어. 커밋 끝 두 줄: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_016MogDNvNcourc5GYJT713m`
- 가상 차: 최고 80 km/h(22.22 m/s), 커브 옆 방향 0.3 g(2.942 m/s²), 출발 전 3초·도착 뒤 2초 정차. 편도는 출발 → 도착, 랩 코스는 한 바퀴.
- 비교 랩 없음, 기록·저장 없음. 모의주행은 5×로 시작.
- 배속 순환 1× → 5× → 10× → 20× → 1×. 프레임 간격 100 ms. 끝에 닿으면 멈춤(닫지 않음).
- 막대·버튼 위 탭은 두 번 탭 보기 바꾸기에 들어가지 않는다.
- 가상 친구 따라가기는 막대 없이 예전 흘려보내기 그대로.
- 입력칸 글자 16px 규칙(`test/style/inputZoom.test.ts`)을 깨지 않는다 (range 입력에 16px 미만 font-size를 주지 않는다).

## Review Focus

1. 뒤로 옮긴 뒤 재생: 지나온 길(빨강)·랩 번호가 그 시점 것이어야 한다(미래 길이 남으면 안 됨) → Task 2 `frameAt` 비교 시험.
2. 아주 긴 코스(평화의댐 50 km, 지나온 길 6000점 넘침): 넘쳐 잘려도 프레임의 길이 맞아야 한다 → Task 2 긴 오벌 시험(`pathDropped`).
3. 코스 선이 없는 코스(지도로 만들고 첫 주행 전): 버튼은 꺼져 있고, 함수는 알기 쉬운 오류 → Task 1·4 시험.
4. 끝까지 간 뒤 재생 누르기: 처음부터 다시 → Task 3 시험.
5. "준비 중"일 때 길게 눌러 끝내기: 계산이 멈추고, 끝난 뒤 재생이 시작되거나 주행 화면으로 돌아가면 안 된다 → Task 3 시험.

---

### Task 1: 코스 중심선 → 가상 코스 → 가상 주행 데이터

**Files:**
- Modify: `src/sim/track.ts` (add `polylineTrack`)
- Create: `src/sim/courseDrive.ts` (export from `src/sim/index.ts`)
- Test: `test/sim/courseDrive.test.ts`

**Interfaces:**
- Produces: `polylineTrack(points: ReadonlyArray<readonly [number, number]>, opts?: { curvatureWindowM?: number }): Track` — 열린 코스(closed=false). ψ는 구간 방향을 펼친 값, 곡률은 `(ψ(s+h) − ψ(s−h)) / 2h`, h = curvatureWindowM/2 (기본 창 20 m). 같은 파일의 `resampleUniform`(0.25 m) 사용.
- Produces: `simulateCourseDrive(course: Course, seed?: number): { gps: GpsSample[]; motion: RawMotionSample[]; durationMs: number }` — 중심선을 `toLocal(course.origin, …)`로 평면 좌표로. 출발 앞 60 m 직선(시작 방향 반대로 늘림), 편도는 도착 뒤 40 m 직선, 랩 코스는 중심선 + 첫 점 + 처음 40 m(출발선을 다시 지나게). `simulateDrive(track, { laps: 1, startStopS: 3, endStopS: 2, vMax: 80 / 3.6, aLatMax: 0.3 * G, aAccel: 2, aBrake: 3 })`, `synthesizeSensors(truth, { ...defaultSensorOpts, seed, origin: course.origin })`. 중심선이 없거나 2점 미만이면 `throw new Error('코스 선이 없어 모의주행을 할 수 없어요')`.

- [ ] **Step 1: 실패하는 시험**
  - `polylineTrack`: 100 m 직선 + 반지름 100 m 원호 90° + 100 m 직선 점들(1 m 간격) → 원호 가운데 `pointAt(s).curvature`가 0.01 ±10%, 직선 가운데 |곡률| < 0.001, `length`가 100+157.08+100 ±1 m.
  - `simulateCourseDrive(하오고개 기본 코스)`(`builtinCourse(BUILTIN_COURSES.find(b=>b.key==='haogogae'), BUILTIN_POINTS.haogogae, { id:'t', gateWidthM:30 })`): 결과를 `new LivePipeline({ course, ref: null })`에 100 ms씩 흘리면 어떤 스냅숏의 `state.lastLap?.lapNo === 1`; 모든 `state.speedKmh <= 81`; 랩 시간 > `course.lengthM / 22.22 * 1000`.
  - 랩 코스(파이프라인 시험처럼 `processDrive`로 만든 오벌 `first.course`): `lastLap.lapNo === 1`이고 2 이상인 랩은 없다.
  - `simulateCourseDrive({ ...course, centerline: null })` → 위 오류 문구로 throw.
- [ ] **Step 2:** `npx vitest run test/sim/courseDrive.test.ts` → FAIL (`polylineTrack` 없음)
- [ ] **Step 3:** 구현 (위 Interfaces 그대로)
- [ ] **Step 4:** 같은 명령 → PASS
- [ ] **Step 5:** 커밋 `모의주행: 코스 중심선으로 가상 코스와 가상 주행 데이터 만들기`

### Task 2: 재생 타임라인 (시작할 때 전부 계산)

**Files:**
- Modify: `src/engine/live/livePipeline.ts` (스냅숏에 `pathDropped`)
- Create: `src/app/replayTimeline.ts`
- Modify (고정 데이터에 `pathDropped: 0` 추가): `test/ui/overlay/overlay.test.ts`, `test/ui/frontGap.test.tsx`, `test/ui/DriveView.test.tsx`
- Test: `test/engine/live/replayTimeline.test.ts`

**Interfaces:**
- Produces: `LiveSnapshot.pathDropped: number` — 6000점 한도로 앞에서 잘라 낸 점 수의 누계 (`path[i]`의 절대 번호 = `pathDropped + i`).
- Produces: `buildReplayTimeline(input: { gps: GpsSample[]; motion: RawMotionSample[]; course: Course | null; ref: LiveRef | null }, opts?: { onProgress?: (fraction: number) => void; yieldEvery?: number; signal?: { aborted: boolean } }): Promise<ReplayTimeline>` — 0부터 끝(GPS·모션 마지막 시각)까지 100 ms마다 `tick`. 프레임에는 `{ ...snap, path: [] }`와 절대 번호 `[pathStart, pathEnd)`, `pathFrom`(절대)을 저장하고, 새로 생긴 점만 공용 기록에 붙인다. `yieldEvery`(기본 600) 프레임마다 `await new Promise(r => setTimeout(r, 0))` 뒤 `onProgress(i / n)`; 끝에 `onProgress(1)`. `signal.aborted`면 `throw new Error('취소')`.
- Produces: `interface ReplayTimeline { stepMs: 100; endMs: number; length: number; indexAt(ms: number): number; frameAt(i: number): LiveSnapshot }` — `indexAt`은 `round(ms/100)`을 [0, length−1]로 자름. `frameAt`은 번호를 잘라 `{ ...frame, path: log.slice(pathStart, pathEnd), pathFrom: pathFrom − pathStart, pathDropped: pathStart }`.

- [ ] **Step 1: 실패하는 시험**
  - 오벌 3바퀴 첫 주행(코스 없음)과 두 번째 주행(코스 있음, 파이프라인 시험의 `first.course`)에서: 같은 입력을 직접 `LivePipeline`에 흘리며 몇 개 시각(0, 1/3, 2/3, 끝)의 `{ t, state.lapNo, state.speedKmh, pos, path 복사본, pathFrom }`을 모아, `frameAt(indexAt(t))`와 같음을 확인 (코스 있는 경우 `path.slice(pathFrom)`도 같음).
  - 긴 오벌(20바퀴, 약 26 km, 점 6000개 넘음): 마지막 프레임의 `path`가 직접 돌린 파이프라인의 마지막 `path`와 같고 `pathDropped > 0`.
  - `indexAt(-500) === 0`, `indexAt(endMs + 9999) === length - 1`.
  - `onProgress` 값이 늘어나기만 하고 마지막이 1.
  - `signal.aborted = true`로 바꾸면 promise가 reject.
- [ ] **Step 2:** `npx vitest run test/engine/live/replayTimeline.test.ts` → FAIL
- [ ] **Step 3:** `pathDropped`(splice할 때 더함, `setCourse`에서 좌표를 옮겨도 그대로) + `replayTimeline.ts` 구현. 시험 고정 데이터 3곳에 `pathDropped: 0`.
- [ ] **Step 4:** `npx vitest run` 전체 → PASS, `npm run typecheck` → 오류 없음
- [ ] **Step 5:** 커밋 `재생: 시작할 때 0.1초마다 화면 상태를 계산해 두는 타임라인`

### Task 3: 재생 플레이어 (drive.ts)

**Files:**
- Modify: `src/app/drive.ts`
- Test: `test/ui/replayPlayer.test.ts` (jsdom, `vi.useFakeTimers()`)

**Interfaces:**
- Consumes: `simulateCourseDrive` (Task 1), `buildReplayTimeline` (Task 2).
- Produces: `ReplaySource` += `{ kind: 'course'; course: Course }`.
- Produces: `DriveState.replay: { label: string; speed: number; ended: boolean; playing: boolean; posMs: number; endMs: number; preparing: number | null; seekable: boolean; returnTo: string } | null`.
- Produces: `startCoursePreview(course: Course): Promise<void>` (= `startReplay({ kind: 'course', course }, 5)`, 이름표 `모의주행 · ${course.name}`, 돌아갈 곳 `#/course/${course.id}`), `setReplayPlaying(on: boolean): void`, `seekReplay(ms: number): void`, `cycleReplaySpeed(): void`, `REPLAY_SPEEDS = [1, 5, 10, 20] as const`.
- 동작: session·sim·course는 먼저 `replay.preparing = 0`으로 `#/drive`에 가고 타임라인을 만든 뒤 `preparing = null, playing = true`. 100 ms마다 재생 중이면 `posMs += 100 × speed`, `publish(frameAt(indexAt(posMs)))`; 끝이면 `posMs = endMs, playing = false, ended = true`. `seekReplay`는 [0, endMs]로 잘라 바로 publish(재생 중이면 계속). 끝난 상태에서 `setReplayPlaying(true)`는 0부터. friendSim은 예전 흘려보내기, `seekable: false`. 돌아갈 곳: 기존 재생은 `#/dev/replay`. `stopReplay`는 만들던 타임라인을 취소(signal)하고 `returnTo`로 간다.

- [ ] **Step 1: 실패하는 시험**
  - `startReplay({ kind: 'sim', withRef: false }, 5)` 뒤 타이머를 돌려 `preparing === null`, `seekable`, `playing`, `endMs > 60_000`.
  - `seekReplay(endMs / 2)` → `getLiveSnapshot()!.t`가 `endMs/2` ±100.
  - `seekReplay(1000)` 뒤 `vi.advanceTimersByTime(1000)` → 5×라 `posMs`가 6000 ±100.
  - `cycleReplaySpeed()` 네 번 → speed 10, 20, 1, 5 순.
  - 끝까지 → `ended && !playing`; `setReplayPlaying(true)` → `posMs` 0부터, `ended === false`.
  - 준비 중에 `stopReplay()` → 만든 뒤에도 `phase === 'idle'`, `replay === null`, `location.hash === '#/dev/replay'`.
  - `startCoursePreview(하오고개 기본 코스)` → `label === '모의주행 · 하오고개'`, `speed === 5`, `returnTo === '#/course/' + id`, 비교 랩 없음(`getDriveState().ref === null`).
- [ ] **Step 2:** `npx vitest run test/ui/replayPlayer.test.ts` → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 전체 시험·타입 검사 → PASS
- [ ] **Step 5:** 커밋 `재생: 막대로 옮기기·멈춤·배속, 코스 모의주행 시작`

### Task 4: 화면 (재생 막대, 준비 중, 모의주행 버튼)

**Files:**
- Create: `src/ui/components/ReplayBar.tsx`
- Modify: `src/ui/screens/DriveScreen.tsx` (DriveView `end()`에 막대, 두 번 탭 제외, 준비 중 표시; DriveScreen이 Task 3 함수를 넘김), `src/ui/screens/CourseDetailScreen.tsx`, `src/ui/styles.css`
- Test: `test/ui/replayBar.test.tsx`, `test/ui/DriveView.test.tsx`(추가), `test/ui/courseDetail*.test.tsx`(있는 시험 파일에 추가, 없으면 `test/ui/coursePreviewButton.test.tsx`)

**Interfaces:**
- Consumes: Task 3의 `DriveState.replay`, `setReplayPlaying`, `seekReplay`, `cycleReplaySpeed`, `startCoursePreview`.
- Produces: `ReplayBar(props: { posMs: number; endMs: number; playing: boolean; speed: number; onPlayPause(): void; onSeek(ms: number): void; onSpeed(): void })` — `div.replay-bar[role=group][aria-label="재생 막대"]` 안에 `button.pp`(aria-label `멈춤`/`재생`, 시안의 두 줄/삼각형 SVG), `span.t` 지금 시간, `input[type=range][aria-label="재생 위치"]`(min 0, max endMs, step 100, value posMs, `onChange` → `onSeek(Number(value))`), `span.t` 전체 시간, `button.spd` 글자 `${speed}×`. 시간 글자 `m:ss`(60분 넘으면 `h:mm:ss`).
- `DriveViewProps` += `replayControls?: { onPlayPause(): void; onSeek(ms: number): void; onSpeed(): void }`. `replay.seekable && replay.preparing === null`일 때 `LongPressButton` 바로 위에 막대. `replay.preparing !== null`이면 `div.notice[role=status]` "준비 중 {Math.round(p×100)}%". `onPointerDown`이 `.replay-bar` 안의 탭은 무시.
- 코스 상세: "이 코스로 주행" 바로 아래 `button.btn.preview-btn` "모의주행 (코스 미리 보기)", `!course.centerline`이면 disabled. 누르면 `startCoursePreview(course)`.
- CSS: 시안 값 그대로 — 막대 칸 `padding 10px 12px; gap 10px; border 1px solid var(--card-line); border-radius 16px; background rgba(16,17,20,.92)`, 재생 버튼 44×44 원 `var(--accent)` 위 `var(--on-accent)`, 시간 `var(--mono)` 13px `var(--fg-2)`, 막대 높이 6px `#2a2e33` 위 채운 부분 `var(--accent)`(`--pct` 변수로 그라데이션), 손잡이 22px 흰 원, 배속 버튼 높이 36·최소 너비 48·`var(--line-strong)` 테두리. 누르는 영역 44px.

- [ ] **Step 1: 실패하는 시험**
  - ReplayBar: posMs 112000·endMs 364000 → 글자 `1:52`, `6:04`; range value `112000`; 버튼 aria-label `멈춤`(playing) / `재생`; 클릭·change가 각각 onPlayPause·onSpeed·onSeek(200000) 부름; `5×` 글자.
  - DriveView: `replay={{ …, seekable: true, preparing: null }}`와 `replayControls`가 있으면 `.replay-bar`가 `.end-btn`보다 앞에 있다; `.replay-bar`에서 두 번 pointerdown해도 `onCycle`이 안 불린다; `preparing: 0.4`면 `준비 중 40%`가 보이고 막대는 없다.
  - 코스 상세: 버튼 `모의주행 (코스 미리 보기)`가 보이고 누르면 `startCoursePreview`(mock)가 그 코스로 불린다; `centerline: null` 코스면 disabled.
- [ ] **Step 2:** 해당 시험 → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 전체 시험·타입 검사·빌드 → PASS
- [ ] **Step 5:** 커밋 `재생 막대·준비 중 표시·코스 상세 모의주행 버튼`

### Task 5: 브라우저 확인과 배포

- [ ] **Step 1:** 가짜 지도 서버(`scratchpad/vmap/fake-api.mjs`) + `VITE_API_URL=http://localhost:8790` 빌드 + `vite preview`로 하오고개 코스 상세 → 모의주행 → 준비 중 → 재생 막대가 시안과 같은지, 막대를 앞뒤로 끌 때 지도·지나온 길·랩 시간이 바뀌는지, 배속 순환, 끝에서 멈춤, 길게 눌러 끝내면 코스 상세로 돌아오는지 화면을 찍어 본다.
- [ ] **Step 2:** `main`에 올리고 CI(테스트·배포) 성공과 `pages_build_version` 확인.
- [ ] **Step 3:** 사용자에게 한국어로 보고(무엇이 됐는지, 그림).
