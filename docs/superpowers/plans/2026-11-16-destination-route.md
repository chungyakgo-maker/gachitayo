# 목적지로 주행 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지도·코스 목록에서 목적지를 고르면 카카오 길찾기 경로를 받아, 처음 가는 길에서도 커브 표지판을 띄우고 벗어나면 다시 찾는다.

**Architecture:** Worker가 카카오모빌리티 길찾기를 대신 부른다(하루 한도). 앱은 일반 주행 위에 경로 안내(RouteGuide: 기존 STracker + paceNotes)를 얹는다. 랩·코스 엔진은 건드리지 않는다.

**Tech Stack:** Cloudflare Worker + D1 (`@cloudflare/vitest-pool-workers`), React 19 / TS strict / Vitest (core = node, ui = jsdom), MapLibre 선 지도 + Leaflet 대체.

**Spec:** `docs/superpowers/specs/2026-11-16-destination-route-design.md`

## Global Constraints

- 모든 글·주석·커밋은 한국어. 커밋 끝 두 줄: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_016MogDNvNcourc5GYJT713m`
- 키는 `KAKAO_REST_API_KEY`(Worker 비밀값)만. 청약고·메리고 키 금지. 좌표는 로그·CI 출력에 남기지 않는다
- 수치: 이탈 50 m · 3초 → 재탐색, 재탐색 최소 20초 간격, 도착 30 m, 하루 300번, 최근 목적지 5개(30 m 안이면 같은 곳), 길게 누르기 550 ms · 10 px
- 코스 주행(course ≠ null)의 화면·엔진 동작은 그대로
- 끝나면: `npx tsc -b` 뒤 `git checkout -- tsconfig.tsbuildinfo`, `npx vitest run`, `cd worker && npx vitest run`

## Review Focus

1. 경로 응답이 늦게 와서 그 사이 다른 목적지를 골랐을 때 → 늦은 응답은 버린다 (Task 3 테스트 `stale plan response is ignored`)
2. GPS가 약할 때 튄 위치로 재탐색 → GPS가 괜찮을 때만 이탈 시간을 잰다 (Task 2 `no reroute while gps weak`)
3. 통신이 끊긴 채 경로를 벗어남 → 예전 경로를 두고 20초 뒤 다시 (Task 3 `failed reroute keeps route and retries after gap`)
4. 재탐색 응답 전에 주행을 끝냄 → 응답이 와도 안내가 되살아나지 않는다 (Task 3 `response after stop is dropped`)
5. 주행 중 평면 원점이 바뀜(첫 GPS로 원점이 정해짐) → 경로를 새 원점으로 다시 만든다 (Task 3 `guide rebuilt when origin changes`)

---

### Task 1: Worker `POST /api/route`

**Files:**
- Create: `worker/migrations/0004_route_usage.sql`, `worker/src/route.ts`, `worker/test/route.test.ts`
- Modify: `worker/src/index.ts` (머리 주석 목록 + `/api/route` 분기)

**Interfaces:**
- Produces: `POST /api/route` 본문 `{ from: {lat, lon}, to: {lat, lon}, headingDeg?: number }` → 200 `RouteResult { distanceM: number; durationS: number; points: Array<[number, number]> /* [위도, 경도] */; destName: string | null }`
- `export const ROUTE_LIMIT_PER_DAY = 300`, `export async function findRoute(env: Cloudflare.Env, userId: string, body: unknown, now?: number): Promise<RouteResult>`

- [ ] **Step 1: 실패하는 테스트** (`vi.spyOn(globalThis, 'fetch')`로 카카오 가짜 응답, kakao.test.ts와 같은 방식)
  - `returns flattened points and dest name`: 두 도로 vertexes `[127,37.5, 127.001,37.5]`, `[127.001,37.5, 127.002,37.501]`, 이름 `''`, `'남산공원길'` → points `[[37.5,127],[37.5,127.001],[37.501,127.002]]`, destName `'남산공원길'`, distanceM·durationS = summary 값
  - `passes heading as angle`: headingDeg 91.6 → 요청 URL에 `origin=127,37.5,angle=92`, 머리 `Authorization: KakaoAK test-rest-key`
  - `kakao result code becomes 404 with its message`: result_code 104, result_msg `'출발지와 도착지가 5 m 이내로 설정된 경우 경로를 탐색할 수 없음'` → 404, `error`가 그 글
  - `kakao http failure becomes 502`: 카카오 401 → 502 `'길찾기 서버가 응답하지 않아요'`
  - `outside korea is 400`: to `{lat: 10, lon: 10}` → 400 `'한국 안에서만 길찾기가 돼요'`, fetch 안 부름
  - `daily limit 429`: route_usage에 오늘(한국 날짜) count 300 넣고 → 429, fetch 안 부름
  - `needs account`: 열쇠 없이 → 401
- [ ] **Step 2:** `cd worker && npx vitest run test/route.test.ts` → FAIL
- [ ] **Step 3: 구현**
  - 표: `CREATE TABLE route_usage (user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day));`
  - 한도: `INSERT INTO route_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 RETURNING count`, 300 초과면 `HttpError(429, '오늘 길찾기를 너무 많이 했어요. 내일 다시 해 주세요')`. day = `new Date(now + 9h).toISOString().slice(0, 10)`
  - 검사 순서: 본문·좌표(400) → 키 없음(503 `'길찾기를 쓸 수 없어요'`) → 한도 → 카카오 (`AbortSignal.timeout(8000)`, `priority=RECOMMEND`)
  - 점: 소수 6자리 반올림, 바로 앞과 같은 점 빼기, 20000점 넘으면 502
  - index.ts: `if (path === '/api/route') { POST만; const userId = await authenticate(req, env); return json(200, headers, await findRoute(env, userId, await readJson(req, 1024))) }`
- [ ] **Step 4:** `cd worker && npx vitest run && npx tsc --noEmit -p .` → 모두 통과
- [ ] **Step 5:** 커밋 `서버: 목적지 길찾기 /api/route (카카오모빌리티, 계정당 하루 300번)`

### Task 2: 엔진 `RouteGuide`

**Files:**
- Create: `src/engine/route/routeGuide.ts`, `test/engine/routeGuide.test.ts`
- Modify: `src/engine/course/sTracker.ts` (생성자 매개변수 형식만)

**Interfaces:**
- `sTracker.ts`: `export interface TrackLine { centerline: Polyline | null; course: { kind: CourseKind } }`, `constructor(geom: TrackLine)` (CourseGeometry는 그대로 들어간다)
- `routeGuide.ts`:
  - `export const ROUTE = { offM: 50, offForMs: 3000, rerouteGapMs: 20_000, arriveM: 30, headingMinMps: 3 } as const`
  - `export interface RouteStep { s: number | null; onRoute: boolean; lateralM: number; remainingM: number | null; arrived: boolean; wantReroute: boolean }`
  - `export class RouteGuide { readonly origin: LatLon; readonly line: Polyline; readonly notes: PaceNote[]; readonly lengthM: number; constructor(points: ReadonlyArray<readonly [number, number]>, origin: LatLon); update(p: { t: number; x: number; y: number; v: number; gpsOk: boolean }): RouteStep }`
  - `export function bearingOfPsi(psi: number): number` (나침반 도, 정수 0~359: `round(90 − psi°) mod 360`)

- [ ] **Step 1: 실패하는 테스트** (경로: 원점에서 북쪽 300 m 직선 → 반지름 40 m 오른쪽 90° → 동쪽 300 m, 위경도는 `fromLocal`로 만든다)
  - `notes from route`: notes에 `dir: 'right'` 하나, lengthM ≈ 663 (±3)
  - `tracks s and remaining`: (0,100) 넣으면 s ≈ 100, onRoute, remainingM ≈ lengthM − 100
  - `reroute after 3 s off`: (200,100)으로 t=0, 1000, 2900 → wantReroute false, t=3100 → true
  - `no reroute while gps weak`: 같은 위치를 gpsOk false로 5초 → false
  - `back on route resets off timer`: 2초 벗어남 → 경로 위 → 다시 2초 벗어남 → false
  - `arrives near end`: 끝점 20 m 앞 → arrived true, 그 뒤 멀리 가도 arrived 그대로, wantReroute false
  - `bearingOfPsi`: psi π/2 → 0, psi 0 → 90, psi π → 270
- [ ] **Step 2:** `npx vitest run test/engine/routeGuide.test.ts` → FAIL
- [ ] **Step 3: 구현**: 점들을 `toLocal`로 → `makePolyline` → `new STracker({ centerline, course: { kind: 'point_to_point' } })`, notes = `paceNotes(line)`. 이탈 시작 시각은 `!onRoute && lateral > offM && gpsOk`일 때만 잡고 아니면 지운다. 도착은 한 번 되면 계속
- [ ] **Step 4:** `npx vitest run test/engine` → 통과 (기존 STracker·코스 테스트 포함)
- [ ] **Step 5:** 커밋 `경로 안내 엔진: 카카오 경로 위 위치·남은 거리·이탈·도착 (STracker 재사용)`

### Task 3: 앱 상태 `routeNav`

**Files:**
- Create: `src/app/routeNav.ts`, `test/app/routeNav.test.ts`
- Modify: `src/app/drive.ts` (`export function subscribeLive(cb: (s: LiveSnapshot | null) => void): () => void`, `export function subscribeDrive(cb: () => void): () => void`)

**Interfaces:**
- Consumes: Task 1 응답, Task 2 `RouteGuide`, `ROUTE`, `bearingOfPsi`; `apiFetch`, `getAuth`, `beginPrepare`, `chooseCourse`, `chooseFreeDrive`, `getDriveState`
- Produces:
  - `export interface Destination { lat: number; lon: number; name: string; kind: 'map' | 'course-start' | 'course-finish' | 'recent' }`
  - `export interface RouteData { distanceM: number; durationS: number; points: Array<[number, number]>; destName: string | null }`
  - `export interface RoutePlan { dest: Destination | null; route: RouteData | null; status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null; record: boolean }` + `getPlan()`, `usePlan()`, `setRecord(on)`, `clearPlan()`, `planTo(dest, from: { lat: number; lon: number }): Promise<void>`
  - `export interface NavLive { guide: RouteGuide; route: RouteData; step: RouteStep | null; status: 'guiding' | 'off' | 'rerouting' | 'arrived' }` + `getNavLive()`, `useNavLive()`
  - `export function startRouteDrive(): void`, `export function stopNav(): void`, `export function navTick(snap: LiveSnapshot, now?: number): void` (테스트용으로 내보냄)
  - `export function recentDestinations(): Destination[]`, `export function rememberDestination(d: Destination): void`
  - `export function courseDestinations(courses: Course[], from: { lat: number; lon: number } | null): Array<Destination & { distanceM: number | null }>`

- [ ] **Step 1: 실패하는 테스트** (node, `globalThis.fetch` 가짜, localStorage는 MemoryStorage — test/app/restore.test.ts 방식, `getAuth`는 `vi.mock('../../src/app/account')`)
  - `plan loads route and names map pick`: kind 'map' 목적지 → status ready, dest.name `'남산공원길 부근'`; destName null이면 `'지도에서 고른 곳'`
  - `stale plan response is ignored`: planTo A(늦게 응답) → planTo B → A 응답이 와도 dest·route는 B
  - `plan error shows server message`: 404 `{error:'도착 지점 …'}` → status error, error 그 글
  - `recent keeps 5 and dedupes within 30 m`
  - `courseDestinations`: 편도 코스 → 출발점·도착점 2개(`'이름 · 출발점'`, `'이름 · 도착점'`), 랩 코스 → `'이름'` 1개, 가까운 순
  - `reroute after off-route uses position and heading`: navTick로 경로 밖 3초 넘게 → fetch 한 번, 본문 from = 지금 위경도, headingDeg = bearingOfPsi(psi) (v ≥ 3), 응답 오면 guide 바뀜, status 'guiding'
  - `failed reroute keeps route and retries after gap`: 실패 → 예전 route 그대로, status 'off', 19초 뒤 navTick → fetch 안 함, 20초 뒤 → 다시
  - `response after stop is dropped`: 재탐색 중 stopNav → 응답 와도 getNavLive() null
  - `guide rebuilt when origin changes`: 원점이 다른 스냅숏 → guide.origin이 새 원점
  - `only while driving`: drive 단계가 preparing이면 navTick가 재탐색하지 않는다
- [ ] **Step 2:** `npx vitest run test/app/routeNav.test.ts` → FAIL
- [ ] **Step 3: 구현**
  - planTo: 요청 번호를 올리고 응답 때 번호가 같을 때만 반영. 오류 글은 `ApiError.message`, 그 밖은 `'통신이 안 돼요. 잠시 뒤 다시 해 주세요'`
  - startRouteDrive: plan이 ready일 때만. `rememberDestination(dest)` → `beginPrepare()` → `record ? chooseCourse(null) : chooseFreeDrive()` → NavLive 만들고 `subscribeLive(navTick)`·`subscribeDrive`(단계가 idle이면 stopNav) 구독
  - navTick: `getDriveState().phase === 'driving'`일 때만 단계·재탐색. `snap.pos`·`snap.origin` 없으면 그대로. 원점이 guide.origin과 다르면 `new RouteGuide(route.points, snap.origin)`. gpsOk = `snap.gps.ready && !snap.state?.status.gpsWeak`
  - 재탐색 조건: `step.wantReroute && !inflight && now − lastReqAt ≥ ROUTE.rerouteGapMs && navigator.onLine !== false`. 진행 방향은 `state.speedKmh/3.6 ≥ ROUTE.headingMinMps`일 때만
  - status: arrived > rerouting(받는 중) > off(`!step.onRoute`) > guiding
  - 최근 목적지 열쇠 `gachitayo.recentDest.v1`
- [ ] **Step 4:** `npx vitest run test/app` → 통과
- [ ] **Step 5:** 커밋 `경로 안내 상태: 목적지·경로 받기·주행 중 재탐색·도착·최근 목적지`

### Task 4: 주행 화면에 경로 (표지판·지도 선·칸 1 제목)

**Files:**
- Modify: `src/ui/overlay/frame.ts` (`OverlayFrame.nav?: { remainingM: number | null; status: NavLive['status'] } | null`, `headline`), `src/ui/overlay/minimap.ts` (`export function routeMapModel(guide: RouteGuide): MapModel`), `src/ui/screens/DriveScreen.tsx` (`DriveViewProps.nav?: NavLive | null`, DriveScreen이 `useNavLive()` 넘김)
- Test: `test/ui/driveRoute.test.tsx`

**Interfaces:**
- Consumes: Task 3 `NavLive`, Task 2 `RouteGuide.notes/lengthM/line/origin`

- [ ] **Step 1: 실패하는 테스트** (DriveView를 course null, nav = Task 2 경로의 guide, step `{ s: 280, onRoute: true, remainingM: 383, … }`, status 'guiding'으로)
  - `route shows next curve sign`: 표지판 칸에 오른쪽 커브 (기존 PaceNoteTile aria-label에 `오른쪽`)
  - `headline shows distance to destination`: 칸 1에 `목적지까지 383m`… 실제 글은 `formatLength` 그대로 (`'목적지까지 383m'`)
  - `off route hides sign and says so`: step.onRoute false, status 'off' → 표지판 없음, `'경로를 벗어났어요'`
  - `rerouting / arrived labels`: `'새 경로 찾는 중…'`, `'도착했어요'`
  - `no record suffix`: noRecord → `'목적지까지 383m · 기록 안 함'`
  - `course drive unchanged`: course가 있으면 nav가 있어도 기존 제목(`'비교 랩 없음'` 등)
- [ ] **Step 2:** `npx vitest run test/ui/driveRoute.test.tsx` → FAIL
- [ ] **Step 3: 구현**
  - headline: `!f.hasCourse && f.nav`면 label = arrived `'도착했어요'` / rerouting `'새 경로 찾는 중…'` / off `'경로를 벗어났어요'` / 그 밖 `` `목적지까지 ${formatLength(remainingM)}` ``, free면 뒤에 `' · 기록 안 함'`, text·plain은 기존 코스 없음과 같게
  - pace: course 우선, 없으면 nav의 notes(loop false). up: nav면 `status === 'guiding' && step.onRoute && step.s !== null`일 때 `upcomingNote`
  - routeMapModel: line = guide.line 점들, start null, finish = 끝점에서 마지막 진행 방향의 `gateSegment(gateFromPoint(...), guide.origin)`, WeakMap 캐시
  - 지도 선 모양은 코스 선과 같은 그리기(하늘색)
- [ ] **Step 4:** `npx vitest run test/ui` → 통과
- [ ] **Step 5:** 커밋 `주행 화면: 목적지 경로 선·다음 커브 표지판·남은 거리`

### Task 5: 지도에 길게 누르기·경로 선·목적지 핀

**Files:**
- Create: `src/ui/map/longPress.ts`, `test/ui/longPress.test.ts`
- Modify: `src/ui/map/mapTypes.ts` (MainMapApi에 `setRoute`, `onLongPress`), `src/ui/map/lineMainMap.ts`, `src/ui/map/leafletMap.ts`, `src/ui/components/MainMap.tsx` (props `route?`, `dest?`, `onLongPress?`), `src/ui/styles.css` (목적지 핀)

**Interfaces:**
- `export function attachLongPress(el: HTMLElement, onPress: (clientX: number, clientY: number) => void, opts?: { ms?: number; slopPx?: number }): () => void` (기본 550, 10)
- MainMapApi: `setRoute(points: ReadonlyArray<readonly [number, number]> | null, dest: { lat: number; lon: number } | null): void` (점이 바뀌면 경로에 맞춰 화면 맞춤, 핀만 있으면 그대로), `onLongPress(cb: ((lat: number, lon: number) => void) | null): void`

- [ ] **Step 1: 실패하는 테스트** (가짜 타이머)
  - `fires after 550 ms`, `move over 10 px cancels`, `second finger cancels`, `touchend before cancels`
  - `contextmenu fires once and is prevented` (마우스 오른쪽·안드로이드), `contextmenu right after touch press is ignored` (800 ms)
- [ ] **Step 2:** `npx vitest run test/ui/longPress.test.ts` → FAIL
- [ ] **Step 3: 구현**: lineMainMap은 `map.getCanvasContainer()`에 붙이고 `map.unproject([x − rect.left, y − rect.top])`, 경로는 `route` geojson 선(하늘색 `#aacae6`, 굵기 5, 둘레 빛) + 핀은 Marker(`map-pin dest`). Leaflet은 `containerPointToLatLng`, `L.polyline`·`L.marker(divIcon)`. 손으로 끌기 시작하면 취소
- [ ] **Step 4:** `npx vitest run test/ui` → 통과
- [ ] **Step 5:** 커밋 `지도: 길게 눌러 고르기·경로 선·목적지 핀`

### Task 6: 목적지 고르기 화면 + 주행 시작 시트

**Files:**
- Create: `src/ui/screens/DestinationScreen.tsx`, `test/ui/destination.test.tsx`
- Modify: `src/ui/components/DriveChoiceSheet.tsx` (prop `onDestination: () => void`, 항목 `목적지로 주행` / `지도에서 목적지를 찍으면 카카오 경로로 커브 표지판을 띄워요`), `src/ui/screens/MainScreen.tsx`, `src/ui/App.tsx` (`'/destination'`), 기존 시트 테스트

**Interfaces:**
- Consumes: Task 3 전부, Task 5 MainMap props

- [ ] **Step 1: 실패하는 테스트** (`vi.mock` routeNav·위치 미리보기)
  - `sheet offers destination drive`: 시트에 `목적지로 주행`, 누르면 onDestination
  - `lists recent and course points`: 최근 1개 + 편도 코스 → `'… · 출발점'`, `'… · 도착점'`, 거리 글
  - `picking a course point plans route`: 누르면 planTo(목적지, 지금 위치)
  - `no fix yet`: 위치 없으면 `'위치 확인 중'`, 목록 눌러도 planTo 안 부름
  - `preview shows summary and start`: plan ready → `'남산공원길 부근'`, `'6.2km · 17분 · 커브 N개'`, 기록 남기기 스위치(켜짐), `이 경로로 출발` 누르면 startRouteDrive
  - `error shows message and retry`
- [ ] **Step 2:** `npx vitest run test/ui/destination.test.tsx` → FAIL
- [ ] **Step 3: 구현**: 위 카드(뒤로 `#/`, 제목 `목적지 고르기`, 안내 `지도를 길게 눌러 목적지를 찍어요`), MainMap(지도 전체, me = fix, route·dest = plan), 아래 카드(목록 / 찾는 중 `경로 찾는 중…` / 미리보기 / 오류). 시간 글: 60분 미만 `N분`, 넘으면 `H시간 M분`. 커브 수는 `new RouteGuide(points, 첫 점).notes.length` (useMemo). 지도에서 찍으면 `{ kind: 'map', name: '지도에서 고른 곳' }`로 planTo. 화면을 떠나 메인으로 가면 clearPlan
- [ ] **Step 4:** `npx vitest run` (전체) + `npx tsc -b` → 통과
- [ ] **Step 5:** 커밋 `목적지 고르기 화면: 지도 길게 눌러·최근·코스 출발점/도착점, 경로 미리보기, 주행 시작 시트에 목적지로 주행`

### Task 7: 시안 사진·문서·배포

**Files:**
- Modify: `docs/specs/2026-11-12-gachitayo-phase1-spec.md` (8.4 경로 안내 한 단락 + 변경 이력 행), `ios` 갈래 `public/privacy.html` (위치 → 카카오모빌리티 한 줄)
- 스크래치: 가짜 API `$S/vmap/fake-api.mjs`에 `/api/route` (고정 경로) 추가

- [ ] **Step 1:** 가짜 API에 `/api/route` → 북악 근처 고정 경로. `VITE_API_URL=http://localhost:8790 npx vite build --base /gachitayo/` + `npx vite preview --port 4173 --base /gachitayo/`
- [ ] **Step 2:** Playwright(폰 크기, deviceScaleFactor 2)로 시트·목적지 목록·미리보기·주행 화면(재생으로 경로 위) 사진
- [ ] **Step 3:** 사양서·개인정보 반영, 커밋
- [ ] **Step 4:** 전체 검사(`npx tsc -b`, `npx vitest run`, `cd worker && npx vitest run`) → main에 합쳐 푸시 → CI(테스트·Worker 배포·D1 migrations·Pages) 성공 확인
- [ ] **Step 5:** 사용자에게 사진과 함께 한국어로 보고
