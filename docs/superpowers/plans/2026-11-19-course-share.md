# 2부: 모두의 코스 (공개 · 받기 · 신고 · 차단 · 관리자) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내 코스를 "모두의 코스"로 공개하고, 다른 사람이 받아 같은 출발선·도착선으로 달리며, 신고 3건 자동 숨김·"이 사람 코스 안 보기"·관리자(세영) 숨김·삭제·공개 막기를 만든다.

**Architecture:** 서버(Worker + D1)에 공개 코스 표와 신고·받기·차단·공개 막기 표를 더하고 `/api/shared…`·`/api/blocks…`·`/api/admin/…` 를 연다(더하기만). 앱은 공개할 코스의 선을 줄여(2 m) 보내고, 받을 때 1 m 로 다시 펴서 폰의 코스(`shared` 표시)로 둔다. 목록 정렬·가까운 순은 폰에서.

**Tech Stack:** TypeScript, React 19, Dexie, Vitest + Testing Library, Cloudflare Worker + D1 (vitest-pool-workers).

**Spec:** `docs/superpowers/specs/2026-11-18-local-records-course-share-design.md` 2부. 시안 `docs/mock/2026-11-18-course-share.jpg` ⑥⑦⑧.

## Global Constraints

- 서버는 **더하기만** (1.0.0 이 같은 서버를 쓴다). 새 표는 `worker/migrations/0013_public_courses.sql`.
- 공개·신고는 카카오·애플 로그인 계정만(서버 `identities` 에 줄이 있는 계정): 아니면 403 "공개하려면 카카오나 Apple로 로그인해 주세요" / "신고하려면 카카오나 Apple로 로그인해 주세요". 보기·받기·주행·차단은 누구나.
- 한도: 계정당 공개 `PUBLISH_LIMIT = 20`, 신고 숨김 `REPORT_HIDE = 3`(서로 다른 사람), 길이 300 m ~ 100 km, 이름 1~40자, 선 2~5000 점, 목록 한 쪽 300개 — 서버 `worker/src/shared.ts` 머리, 앱 `src/app/limits.ts`.
- 문구: 공개 창 경고 "코스 선·이름·내 닉네임이 모두에게 보여요. 출발·도착이 집이나 회사 근처면 공개하지 마세요.", 체크 "일반 도로 법규를 지키며 달릴 수 있는 길이에요", "기록(랩 시간)은 올라가지 않아요. 언제든 공개를 내릴 수 있어요." 나쁜 말 400 "이름에 쓸 수 없는 말이 있어요". 공개 막힌 계정 403 "이 계정은 코스를 공개할 수 없어요".
- 관리자 = Worker 비밀값 `ADMIN_USER_IDS`(쉼표 구분 계정 번호, CI 비밀값 목록에 더함). `/api/me` 가 `admin: true|false`.
- 위치를 서버로 보내는 새 요청 없음 (가까운 순은 폰에서 정렬).
- 시·도: `SIDOS = ['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주']`. 앱이 출발점으로 짐작해 고르게 하고 바꿀 수 있다(서버는 목록 안의 값이거나 빈칸만 받는다).
- 매 작업 끝: `npx tsc --noEmit -p .`, `npx vitest run`, 서버 작업은 `cd worker && npx tsc --noEmit -p . && npx vitest run`.

## Review Focus

1. 같은 사람이 같은 코스를 여러 번 신고·받기해도 숫자가 한 번만 오른다 → Task 2 `신고는 한 사람 한 번`, Task 1 `받기는 한 사람 한 번`.
2. 숨긴 코스·차단한 사람·공개 막힌 사람의 코스는 목록·상세에 안 보인다(관리자·올린 사람은 상세에서 본다) → Task 2 테스트.
3. 받은 코스를 두 번 받거나, 이미 같은 모양 코스가 있으면 새로 생기지 않는다 → Task 4 `이미 있으면 그 코스`.
4. 줄인 선을 다시 편 코스로 달려도 출발·도착선이 그대로다(게이트 값은 줄이지 않는다) → Task 3 `게이트는 그대로, 선 오차 2 m 안`.
5. 계정을 지우면 공개 코스·신고·받기·차단·공개 막기·주행 신호 줄이 모두 지워진다 → Task 2 `계정 지우기 정리`.

---

### Task 1: 서버 — 공개 코스 표 · 공개 · 목록 · 상세 · 고치기 · 내리기 · 받기

**Files:**
- Create: `worker/migrations/0013_public_courses.sql`, `worker/src/shared.ts`, `worker/src/badWords.ts`, `worker/test/shared.test.ts`
- Modify: `worker/src/index.ts` (경로·머리 주석), `worker/src/env.d.ts` (`ADMIN_USER_IDS?: string`)

**Interfaces (서버, JSON):**
- 표: `public_courses(id TEXT PK, owner_id TEXT NOT NULL, name TEXT, region TEXT, kind TEXT, length_m REAL, start_gate TEXT, finish_gate TEXT, sector_bounds TEXT, line TEXT, thumb TEXT, start_lat REAL, start_lon REAL, adds INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER, updated_at INTEGER)` + 색인 `(status, created_at)`, `(owner_id)`; `course_adds(course_id, user_id, at, PK(course_id,user_id))`; `course_reports(course_id, user_id, reason, note, at, PK(course_id,user_id))`; `user_blocks(user_id, blocked_id, at, PK(user_id,blocked_id))`; `publish_bans(user_id PK, at)`.
- 몸(공개·고치기): `SharedBody = { name, region, kind: 'loop'|'point_to_point', lengthM, startGate: Gate, finishGate: Gate, sectorBoundsM: [number,number]|null, line: Array<[lat,lon]>, thumb: Array<[lat,lon]> }` (thumb ≤ 40 점).
- `POST /api/shared` → 201 `{ id }` · `PUT /api/shared/{id}` (올린 사람) → `{ id }` · `DELETE /api/shared/{id}` (올린 사람·관리자) → `{ ok: true }` (받기·신고 줄도 지움)
- `GET /api/shared?after=` → `{ items: SharedSummary[], next: string | null }` (공개 중인 것, 새것부터 300개씩) · `SharedSummary = { id, name, region, kind, lengthM, start: {lat, lon}, thumb, adds, by, byId, createdAt, mine }`
- `GET /api/shared/{id}` → `SharedSummary & { line, startGate, finishGate, sectorBoundsM, status }` (숨긴 것은 올린 사람·관리자만, 아니면 404)
- `POST /api/shared/{id}/add` → `{ adds }` (한 사람 한 번만 오름)

- [ ] **Step 1: 실패하는 테스트** (`worker/test/shared.test.ts`, browse.test 의 call·newUser 꼴 + `identities` 에 카카오 줄 넣는 `signedIn(u)`)
  - `로그인 안 한 계정은 공개 403 (문구)`, `로그인한 계정은 공개 201, 목록·상세에 보인다 (by = 닉네임, mine)`.
  - `이름 나쁜 말 400`, `길이 299 m·100.1 km 400`, `선 1점·5001점 400`, `지역은 목록 안 값이거나 빈칸`.
  - `계정당 20개까지 (21번째 400 "공개는 20개까지예요")`.
  - `고치기·내리기는 올린 사람만 (남 403)`, `내리면 목록·상세에서 사라짐`.
  - `받기는 한 사람 한 번 (adds 1)`.
  - `목록은 300개씩, next 로 다음 쪽`.
- [ ] **Step 2:** `cd worker && npx vitest run test/shared.test.ts` → FAIL
- [ ] **Step 3:** 구현. 나쁜 말 목록은 `badWords.ts` 한 곳(소문자·공백 뺀 이름에 포함되면 거름, 몇 단어로 시작). 목록 커서 = `"{created_at}:{id}"`.
- [ ] **Step 4:** PASS, `npx tsc --noEmit -p .`
- [ ] **Step 5:** 커밋 `모두의 코스 1: 서버 공개·목록·상세·고치기·내리기·받기`

### Task 2: 서버 — 신고·자동 숨김·차단·관리자·공개 막기·계정 지우기·인기

**Files:**
- Modify: `worker/src/shared.ts`, `worker/src/index.ts`, `worker/src/data.ts` (getMe `admin`, deleteAccount 정리 — **1부에서 빠진 `course_drives` 도**), `worker/src/browse.ts` (`s:` 열쇠 인기), `.github/workflows/ci.yml` (비밀값 목록에 `ADMIN_USER_IDS`)
- Test: `worker/test/shared.test.ts`, `worker/test/browse.test.ts`, `worker/test/api.test.ts`(계정 지우기)

**Interfaces:**
- `POST /api/shared/{id}/report { reason: 'danger'|'illegal'|'name'|'other', note?: string(≤100) }` → `{ ok: true }` (로그인 계정만, 자기 코스 400, 한 사람 한 번, 서로 다른 3명이면 `status='hidden'`)
- `GET /api/blocks` → `Array<{ userId, nickname }>` · `POST /api/blocks { userId }` · `DELETE /api/blocks/{userId}` (목록·상세에서 그 사람 코스를 뺀다)
- 관리자만(아니면 403): `GET /api/admin/shared` → `Array<SharedSummary & { status, reports, reasons: Record<string, number> }>` (숨김·신고 있는 것 먼저, 그다음 새것부터) · `POST /api/admin/shared/{id} { action: 'hide'|'show' }` · `POST /api/admin/bans { userId }` (그 계정 공개 코스 모두 숨김 + 새 공개 막음) · `DELETE /api/admin/bans/{userId}` · `GET /api/me` 에 `admin`
- 인기: `popular()` 결과에 `{ builtin: 's:{id}', drivers }` 줄도 (공개 코스 신호 `course_drives` 의 `s:` 열쇠). 실시간 `/api/driving` 은 이미 아무 열쇠나 받는다.

- [ ] **Step 1: 실패하는 테스트**
  - `신고는 로그인 계정만·한 사람 한 번·자기 코스는 400`, `서로 다른 3명 신고면 숨김 → 목록·상세(남) 404, 올린 사람·관리자는 상세에서 status hidden`.
  - `차단하면 그 사람 코스가 목록에서 빠지고, 풀면 돌아온다`, `GET /api/blocks 에 닉네임`.
  - `관리자 아니면 /api/admin/* 403`, `관리자 목록은 숨김·신고 먼저`, `hide·show`, `관리자는 남의 코스 DELETE 가능`, `공개 막기: 그 계정 코스 모두 숨김 + 새 공개 403 문구, 풀면 공개 가능`.
  - `/api/me 의 admin` (ADMIN_USER_IDS 에 있으면 true).
  - `계정 지우기 정리`: public_courses·course_adds·course_reports·user_blocks(양쪽)·publish_bans·course_drives 줄이 0.
  - 인기: `s: 신호도 셈 ({builtin: 's:abc', drivers})`.
- [ ] **Step 2–5:** FAIL → 구현 → PASS·tsc → 커밋 `모두의 코스 2: 신고·자동 숨김·차단·관리자·공개 막기, 계정 지우기 정리`

### Task 3: 앱 엔진 — 선 줄이기·펴기, 공개 몸 만들기, 받은 코스 만들기, 시·도 짐작

**Files:**
- Create: `src/engine/course/share.ts`, `src/courses/sidos.ts`
- Modify: `src/types/course.ts` (`CourseSource` 에 `'shared'`, `Course.shared?: { id: string; by: string }` — 받은 코스, `Course.publishedId?: string` — 내가 공개한 코스), `src/ui/screens/CourseDetailScreen.tsx:70` (`SOURCE.shared = '모두의 코스'`)
- Test: `test/engine/courseShare.test.ts`, `test/courses/sidos.test.ts`

**Interfaces:**
- `simplifyLine(pts: Array<[number, number]>, toleranceM: number): Array<[number, number]>` (더글라스-포이커, 첫 점 기준 평면 좌표, 끝점 둘은 언제나 남김)
- `expandLine(pts: Array<[number, number]>, spacingM: number): Array<[number, number]>` (`resamplePolyline` 사용)
- `sharedBody(c: Course, region: Sido | ''): SharedBody` (선 없으면 Error "한 번 달려 코스 선이 생긴 뒤에 공개할 수 있어요", 좌표 소수 6자리, line = 2 m 줄임, thumb = 40점 이하가 될 때까지 허용 오차를 2배씩)
- `courseFromShared(d: SharedDetail, id: string): Course` (origin = 출발선 점, centerline = 1 m 로 편 선, `source: 'shared'`, `shared: { id: d.id, by: d.by }`, version 1)
- `SIDOS` (Global Constraints 그대로), `type Sido`, `guessSido(lat: number, lon: number): Sido` (시·도 대표점 17개 중 가장 가까운 것)

- [ ] **Step 1: 실패하는 테스트**
  - `게이트는 그대로, 선 오차 2 m 안`: 시뮬 코스(test/generators 의 stadiumTrack 처리 결과) → sharedBody → courseFromShared → 출발·도착 게이트 값 같음, 펴진 선의 각 점이 원래 선에서 2 m 이내, 길이 차 1% 이내, 원래보다 점 수가 크게 줄어듦(1/5 이하).
  - `thumb 40점 이하`, `선 없는 코스는 오류 문구`.
  - `guessSido`: 서울시청(37.5665,126.978)→서울, 춘천(37.88,127.73)→강원, 제주시(33.5,126.53)→제주, 부산(35.18,129.08)→부산.
- [ ] **Step 2–5:** FAIL → 구현 → PASS·tsc → 커밋 `모두의 코스 3: 선 줄이기·펴기, 공개 몸·받은 코스, 시·도 짐작`

### Task 4: 앱 상태 — 모두의 코스 API · 받기 · 공개·고치기·내리기 · 신고·차단 · 관리자 · 신호

**Files:**
- Create: `src/app/sharedCourses.ts`
- Modify: `src/app/coursePrefs.ts` (`prefKey`: 받은 코스는 `s:{id}`), `src/app/account.ts` (`/api/me` 의 `admin` 을 상태에 `admin: boolean`), `src/app/droveSignal.ts`·`src/app/drivingSignal.ts` (받은 코스는 `s:{id}`), `src/app/courseFilter.ts` (popular 줄 `s:` 를 받은 코스와 잇기), `src/app/limits.ts` (`PUBLISH_LIMIT = 20`)
- Test: `test/app/sharedCourses.test.ts`; 고침 `test/app/droveSignal.test.ts`, `test/app/drivingSignal.test.ts`, `test/app/courseFilter.test.ts`, `test/app/coursePrefs.test.ts`

**Interfaces:**
- `fetchShared(force?: boolean): Promise<SharedSummary[]>` (쪽을 끝까지, 1분 기억) · `sortShared(list, by: 'near'|'adds'|'new', here: LatLon | null): SharedSummary[]` (near 인데 here 없으면 adds) · `fetchSharedDetail(id): Promise<SharedDetail>`
- `addSharedToPhone(id: string): Promise<Course>` — 같은 `shared.id` 코스 있으면 그것, 같은 모양(`sameCourse`) 있으면 그것(그 코스에 `shared` 붙이지 않음), 아니면 `assertCourseRoom` 뒤 새로 담고 `POST …/add`, `loadCourses()`
- `publishCourse(courseId: string, region: Sido | ''): Promise<string>` (공개 번호, 폰 코스에 `publishedId`) · `updatePublished(courseId)` · `unpublish(courseId)` (서버 404 도 성공으로, `publishedId` 지움) · `reportShared(id, reason, note?)` · `blockUser(userId)` · `unblockUser(userId)` · `listBlocks()` · 관리자 `adminList()`, `adminSet(id, 'hide'|'show')`, `adminDelete(id)`, `adminBan(userId)`, `adminUnban(userId)`
- `courseKey(c: Course): string | null` — 기본 코스 `b:{key}`, 받은 코스 `s:{id}`, 아니면 null (drove·driving·즐겨찾기 열쇠가 이걸 씀)

- [ ] **Step 1: 실패하는 테스트** (fetch 가짜, fake-indexeddb)
  - `받기: 새로 담고 add 한 번, 두 번째는 같은 코스 (add 다시 안 부름)`, `이미 같은 모양 코스가 있으면 그 코스`, `코스 200개면 한도 문구`.
  - `공개: 몸에 선·게이트, 폰 코스에 publishedId`, `내리기: publishedId 지움 (서버 404 도)`.
  - `sortShared near/adds/new`, `fetchShared 가 next 로 끝까지`.
  - `courseKey`, `받은 코스 주행 신호 s:{id}`, `인기 s: 줄이 받은 코스와 이어진다`, `즐겨찾기 열쇠 s:{id}`.
  - `account: /api/me admin`.
- [ ] **Step 2–5:** FAIL → 구현 → PASS·tsc → 커밋 `모두의 코스 4: 앱 상태 (받기·공개·신고·차단·관리자·신호 열쇠)`

### Task 5: 화면 — 코스 탭 "모두의 코스" 목록 + 공개 코스 상세 (시안 ⑦⑧)

**Files:**
- Create: `src/ui/screens/SharedCourseScreen.tsx` (`#/shared/{id}`), `src/ui/components/SharedCourseList.tsx`, `src/ui/components/ReportSheet.tsx`
- Modify: `src/app/courseFilter.ts` (`CourseFilter` 에 `'shared'` "모두의 코스" — 기본 코스 다음), `src/app/settings.ts` (`sharedSort: 'near'|'adds'|'new'` 기본 'near'), `src/ui/components/CourseChips.tsx` (shared 면 정렬 칩 "가까운 순·많이 받은 순·새로 올라온 순"), `src/ui/screens/CoursesScreen.tsx`, `src/ui/App.tsx` (경로), `src/ui/components/CourseThumb.tsx`(thumb 점으로도 그리기, 필요하면)
- Test: `test/ui/sharedCourses.test.tsx`

**Interfaces:**
- Consumes: Task 4 전부, `prepareWithCourse`(drive.ts), `handOffDestination`(routeNav.ts), `useLocationPreview`(가까운 순 위치)
- 상세 단추: "이 코스로 주행"(받고 바로 주행 준비) · "내 코스에 담기"(이미 있으면 "내 코스에 있어요" → 그 코스 열기) · "출발점으로 길찾기" · 작게 "신고" · "이 사람 코스 안 보기"(확인 창). 숨겨진 내 코스면 "신고로 숨겨졌어요" 안내.
- 신고 창: 이유 4개(위험한 길·불법 주행 유도·이름이 불쾌함·기타) + 기타 한 줄 → "신고했어요. 3명이 신고하면 바로 숨겨지고 운영자가 확인해요".

- [ ] **Step 1: 실패하는 테스트**
  - `칩 "모두의 코스" → 정렬 칩 3개, 줄에 이름·종류·길이·지역·"올린 사람 ○○ · N명 받음"`.
  - `줄을 누르면 #/shared/{id}`, `상세: 이 코스로 주행 → addSharedToPhone + prepareWithCourse`, `담기 → "내 코스에 있어요"`.
  - `신고 창 → reportShared(id, 'danger')`, `안 보기 → 확인 → blockUser(byId) → 목록으로`.
  - `로그인 안 한 계정은 신고 대신 "신고하려면 카카오나 Apple로 로그인해 주세요"`.
- [ ] **Step 2–5:** FAIL → 구현 → PASS·tsc → 커밋 `모두의 코스 5: 코스 탭 목록·정렬, 공개 코스 상세·신고·안 보기`

### Task 6: 화면 — 내 코스 공개하기 · 공개 중 (시안 ⑥)

**Files:**
- Create: `src/ui/components/PublishSheet.tsx`
- Modify: `src/ui/screens/CourseDetailScreen.tsx` (내 코스(기본·받은 코스 아님)에 "모두에게 공개", 공개 중이면 "공개 중 · N명 받음" + "공개 코스도 고친 선으로 바꾸기"(이름·선·버전이 공개 뒤 바뀐 때만 켬 — 공개할 때 버전을 `publishedVersion` 으로 기억) + "공개 내리기"(확인 창))
- Test: `test/ui/publishCourse.test.tsx`

**Interfaces:** `Course.publishedVersion?: number` 추가(Task 3 의 type 파일), Task 4 publish/update/unpublish.

- [ ] **Step 1: 실패하는 테스트**
  - `선 없는 코스·기본 코스·받은 코스엔 단추 없음`.
  - `공개 창: 이름·종류·길이·지역(짐작값이 골라져 있음, 바꿀 수 있음), 경고 문구, 체크해야 공개하기 켜짐 → publishCourse(id, '강원')`.
  - `로그인 안 했으면 창 대신 "공개하려면 카카오나 Apple로 로그인해 주세요"`.
  - `공개 중: "공개 중", 선을 고친 뒤 "공개 코스도 고친 선으로 바꾸기" 켜짐, 내리기 확인 → unpublish`.
- [ ] **Step 2–5:** FAIL → 구현 → PASS·tsc → 커밋 `모두의 코스 6: 내 코스 공개하기·공개 중·바꾸기·내리기`

### Task 7: 화면 — 설정 "안 보는 사람" · 계정 번호 · 관리자 화면

**Files:**
- Create: `src/ui/screens/AdminSharedScreen.tsx` (`#/admin/shared`), `src/ui/components/BlocksSection.tsx`
- Modify: `src/ui/screens/SettingsScreen.tsx` (계정 칸 맨 아래 "계정 번호 복사" — 번호 앞 8자리만 보이고 누르면 전체 복사; "안 보는 사람" 칸(있을 때만); 관리자면 "관리자 · 모두의 코스 관리" 링크), `src/ui/App.tsx`
- Test: `test/ui/adminShared.test.tsx`

- [ ] **Step 1: 실패하는 테스트**
  - `계정 번호 복사 → navigator.clipboard.writeText(userId)`.
  - `안 보는 사람: 닉네임과 "풀기" → unblockUser`.
  - `관리자 아니면 링크 없음, 관리자면 있음`, `관리자 화면: 숨김·신고 먼저, 신고 이유 수, 숨기기/숨김 풀기/지우기(확인)/이 계정 공개 막기(확인)`.
- [ ] **Step 2–5:** FAIL → 구현 → PASS·tsc → 커밋 `모두의 코스 7: 안 보는 사람·계정 번호·관리자 화면`

### Task 8: 메인 지도 "모두의 코스" 칩

**Files:**
- Modify: `src/ui/screens/MainScreen.tsx` (칩이 shared 면 공개 코스 출발점 표시(폰에 없는 것도), 누르면 `#/shared/{id}`), 지도 표시는 지금 코스 표시 방식(점·선 그리기)을 따른다
- Test: `test/ui/mainBrowse.test.tsx` 에 추가

- [ ] **Step 1: 실패하는 테스트** `모두의 코스 칩이면 공개 코스 출발점 목록이 지도 칸에 넘어가고, 누르면 상세로`
- [ ] **Step 2–5:** FAIL → 구현 → PASS·tsc → 커밋 `모두의 코스 8: 메인 지도 칩`

### Task 9: 문서·약관·시안 확인

**Files:** `public/privacy.html` (공개한 코스: 이름·선·출발·도착선·닉네임이 모두에게 보임, 신고·차단 정보, 계정 지우면 지움), 이용 규칙(`public/privacy.html` 또는 약관 페이지에 "불쾌·위험한 코스는 지우고 올린 계정의 공개를 막을 수 있습니다" 한 줄), `docs/release/app-store.md` (1.0.1: 사용자 콘텐츠 "공개한 코스", 심사 메모 — 공개·신고·차단·관리자 위치(영어)), `src/ui/help/helpCards.ts` ("코스 둘러보기" 카드에 모두의 코스 한 줄, 3줄 유지), `docs/아이폰-앱-진행기록.md`, 설계 변경 이력. Playwright 로 정식 빌드 코스 탭·상세·공개 창을 찍어 시안 ⑥⑦⑧과 비교(커밋 안 함).
- [ ] 고치고 전체 테스트·tsc → 커밋 `모두의 코스 9: 개인정보·이용 규칙·앱스토어·도움말·진행기록`
