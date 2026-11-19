# 1부: 기록은 폰에만 · 동기화 없앰 · 저장 공간 · 백업 파일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주행 기록·내 코스·즐겨찾기를 폰에만 두고(업로드·동기화·되살리기 없앰), 원본 30개·코스 200개 한도, 백업 파일 만들기·불러오기, 처음 한 번 서버 기록 옮기기, 인기 도로 새 신호를 만든다.

**Architecture:** 업로드 대기열(`sync.ts`/`syncEngine.ts`)을 걷어 내고, 지우기만 남긴 작은 모듈(`records.ts`)과 한 번 옮기기(`migrateLocal.ts`, 지금 `restore.ts`를 다듬어 씀)를 둔다. 한도는 `limits.ts` 한 곳. 백업은 ZIP(`fflate`)을 기록마다 따로 묶는다. 서버는 `POST /api/drove`와 표 하나만 더한다.

**Tech Stack:** TypeScript, React 19, Dexie(IndexedDB), Vitest + Testing Library, Capacitor(Filesystem·Share), Cloudflare Worker + D1, fflate.

**Spec:** `docs/superpowers/specs/2026-11-18-local-records-course-share-design.md` (1부). 시안 `docs/mock/2026-11-18-local-storage.jpg`.

## Global Constraints

- 화면 글은 한국어 존댓말 짧게, 주석은 한국어로 "왜"를 (기존 파일 스타일).
- 서버는 **더하기만**: `/api/sessions`·`/api/courses`·`/files/…`·`/api/prefs`는 지우거나 바꾸지 않는다 (1.0.0 앱).
- 한도 값: 원본 `RAW_KEEP = 30`, 내 코스 `MY_COURSE_LIMIT = 200`, 백업 알림 `BACKUP_REMIND_DAYS = 30`·`BACKUP_REMIND_MIN = 5` — 모두 `src/app/limits.ts` 한 곳.
- 코스 한도 문구: "내 코스가 200개예요. 안 쓰는 코스를 지운 뒤 다시 해 주세요".
- 백업 파일 이름: `디고 백업 YYYY-MM-DD.dgo` (한국 날짜).
- 위치를 서버로 보내는 새 요청 없음. `/api/drove`는 코스 열쇠만.
- 정식 빌드(`VITE_LOCATION_SHARING=off`) 기준 화면. 모델 이름은 커밋에 넣지 않는다. 커밋 끝 두 줄(Co-Authored-By, Claude-Session).
- 매 작업 끝: `npx tsc --noEmit -p .` 와 `npx vitest run` 통과 (서버 작업은 `cd worker && npx vitest run` 도).

## Review Focus

1. 주행 중·처리 중인 기록의 원본은 절대 지우지 않는다 → Task 1 테스트 `recording·finished(계산 전)·noRecord 는 30개 밖이어도 원본 유지`.
2. 옮기기 중 앱이 꺼지거나 통신이 끊겨도 기록이 두 번 생기거나 지운 기록이 되살아나지 않는다 → Task 3 테스트 `지우기 목록 id 는 받지 않는다`, `restoring 남은 것 지우고 다시`.
3. 백업 불러오기를 두 번 해도 기록·코스가 겹치지 않는다 → Task 5 테스트 `같은 파일 두 번 불러와도 개수 그대로`.
4. 망가진·다른 앱 파일을 불러오면 아무것도 바꾸지 않고 "디고 백업 파일이 아니에요" → Task 5 테스트.
5. 로그아웃이 통신 없이도 되고, 기본으로 기록이 남는다 → Task 6 테스트 `통신 실패해도 폰은 로그아웃, 기록 그대로`.

---

### Task 1: 한도 값 · 원본 정리 · 코스 한도

**Files:**
- Create: `src/app/limits.ts`, `src/app/storageLimits.ts`
- Modify: `src/types/session.ts` (SessionRecord에 `rawPruned?: boolean` — "원본을 한도로 정리함, 다시 재생·계산 안 됨"), `src/app/drive.ts:348-356` (`andUpload` → 처리 뒤 `pruneOldRaw`), `src/app/courses.ts` (createMapCourse·importGpx(course 모드)·makeReverseCourse 앞에서 한도 확인), `src/app/sessionProcessing.ts` (saveDetourAsNew·saveProposedCourse 앞에서 한도 확인)
- Test: `test/app/storageLimits.test.ts`

**Interfaces:**
- Produces: `RAW_KEEP`, `MY_COURSE_LIMIT`, `BACKUP_REMIND_DAYS`, `BACKUP_REMIND_MIN` (limits.ts) · `pruneOldRaw(repo: SessionRepo, keep?: number): Promise<number>` (지운 기록 수) · `assertCourseRoom(drive: DriveRepo, adding?: number): Promise<void>` (넘으면 위 문구로 Error) · `myCourseCount(drive: DriveRepo): Promise<number>` · `storageSummary(): Promise<{ sessions: number; rawSessions: number; rawBytes: number; myCourses: number; usage: { used: number; quota: number } | null }>`

- [ ] **Step 1: 실패하는 테스트** (fake-indexeddb는 기존 storage 테스트처럼)
  - `최근 30개만 원본 유지`: processed 35개(startedAt 다르게, 각 덩어리 1개) → `pruneOldRaw` = 5, 가장 오래된 5개 `chunks()` 빈 배열·`rawPruned: true`, 나머지 30개 그대로.
  - `recording·finished(계산 전)·noRecord 는 30개 밖이어도 원본 유지` (세지도 않음: processed 30 + 오래된 finished 1 → 0개 지움).
  - `두 번 불러도 같은 결과` (두 번째 = 0).
  - `assertCourseRoom`: 기본 코스 10 + 내 코스 200 → `rejects.toThrow('내 코스가 200개예요. 안 쓰는 코스를 지운 뒤 다시 해 주세요')`, 199면 통과.
  - `createMapCourse` 가 한도에서 같은 오류 (courses.test.ts 방식).
- [ ] **Step 2:** `npx vitest run test/app/storageLimits.test.ts` → FAIL (모듈 없음)
- [ ] **Step 3:** 구현. 정리 대상 = status `processed`·`uploaded` 이고 `restoring`·`noRecord` 아님, startedAt 내림차순 `keep`번째부터 `deleteChunks` + `rawPruned: true`. `rawBytes` 는 원본 덩어리의 샘플 수 × 대략 바이트(만드는 사람이 정함), `usage` 는 `navigator.storage?.estimate()` (없으면 null). `drive.ts` 의 `andUpload` 를 `afterProcess` 로 이름 바꾸고 `void pruneOldRaw(getRepo()).then(refreshSessions)`.
- [ ] **Step 4:** 테스트 PASS + 전체 `npx vitest run`, `npx tsc --noEmit -p .`
- [ ] **Step 5:** 커밋 `기록 폰에만 1: 한도 값, 원본 최근 30개만, 내 코스 200개`

### Task 2: 동기화 걷어 내기 · 기록 지우기 · 예전 대기열 정리

**Files:**
- Create: `src/app/records.ts`
- Modify: `src/app/sync.ts` (지움 — 대신 records.ts), `src/sync/syncEngine.ts` (upload·cleanupUploaded·syncOnce 지움; `Remote` 중 `deleteSession`·`deleteCourse` 만 쓰는 작은 꼴로), `src/server/remote.ts` (지우기 두 개만 남겨도 됨), `src/app/courses.ts` (queueCourse·kickSync·enqueueCourseDelete 빼고, `ensureRaw` 서버 받기 빼고, deleteCourse 는 records 의 `forgetServerCourse`), `src/app/drive.ts` (enqueueSessionUpload 부르던 곳), `src/ui/screens/HistoryScreen.tsx` (import 경로), `src/main.tsx` (initSync → `initRecords`)
- Test: `test/app/records.test.ts`; 지우거나 고침: `test/sync/syncEngine.test.ts`, `test/ui/deleteRecord.test.ts`, `test/ui/historyDelete.test.tsx`

**Interfaces:**
- Produces: `deleteSessionRecord(sessionId: string): Promise<void>` (폰에서 지우고, `uploadedAt` 이 있으면 서버 `DELETE /api/sessions/{id}`; 실패하면 `gachitayo.serverDeletes.v1` 목록에 남김) · `forgetServerCourse(courseId: string): Promise<void>` (같은 방식, `DELETE /api/courses/{id}`, 409면 목록에 남김) · `pendingServerDeletes(): { sessions: string[]; courses: string[] }` · `flushServerDeletes(): Promise<void>` · `initRecords(): Promise<void>` (예전 `uploadQueue` 의 `session-delete`·`course-delete` 를 목록으로 옮기고 나머지 항목은 버린 뒤 비움, 그리고 flush; `online` 때 다시 flush)
- Consumes: `getAuth()`, `apiFetch` (src/server/api)

- [ ] **Step 1: 실패하는 테스트**
  - `올린 적 있는 기록을 지우면 서버에도 DELETE` (apiFetch 가짜, `uploadedAt` 있음 → 호출 1번, 없음 → 0번).
  - `통신 실패면 목록에 남고 flush 때 다시` (첫 호출 TypeError → `pendingServerDeletes().sessions` = [id], 두 번째 flush 성공 → 빈 목록).
  - `서버가 403·404면 목록에서 뺀다` (다른 계정·이미 없음).
  - `예전 대기열: session-delete·course-delete 만 옮기고 session·course 올리기는 버린다` (getQueueRepo 에 4가지 넣고 `initRecords` → 목록 2개, 대기열 0개).
  - `기록 중인 주행은 지울 수 없어요` (기존 문구 그대로).
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 대기열 표(`uploadQueue`)는 DB 판은 그대로 두고(예전 데이터 읽기용) 새로 넣지 않는다. 처리 뒤 올리기 없음.
- [ ] **Step 4:** 이 작업 테스트 + 고친 예전 테스트 PASS, 전체·tsc
- [ ] **Step 5:** 커밋 `기록 폰에만 2: 업로드·동기화 없앰, 지우기만 서버에 (예전 대기열 정리)`

### Task 3: 처음 한 번 옮기기 (서버 → 폰)

**Files:**
- Create: `src/app/migrateLocal.ts`
- Modify: `src/app/restore.ts` (restoreOne·serverLists·matchBuiltin·toCourse 는 그대로 쓰게 내보내고, 3번 "올리기"와 평소 `startRestore` 흐름은 지움. `localOnlySessions` 지움), `src/main.tsx` (`startRestore` → `startMigrateLocal`, 카카오·애플 로그인 뒤에도), `src/ui/components/RestoreBanner.tsx` (문구 "예전 기록을 이 폰으로 옮기는 중 N/M")
- Test: `test/app/migrateLocal.test.ts`; 고침 `test/app/restore.test.ts`(옮기기 테스트로 합치거나 지움)

**Interfaces:**
- Produces: `startMigrateLocal(): Promise<void>` · `migratedUsers(): string[]` (localStorage `gachitayo.localOnly.v1` = 끝난 계정 id 목록) · `useMigrate()` (지금 `useRestore` 꼴: running·done·total·failed)
- Consumes: `pendingServerDeletes()` (Task 2), `RAW_KEEP` (Task 1)

- [ ] **Step 1: 실패하는 테스트** (fetch·apiFetch 가짜, restore.test.ts 의 준비 코드 재사용)
  - `서버에만 있는 기록을 받아 같은 id로 계산` (기존 restore 테스트 옮김).
  - `폰에 있지만 원본이 없는 기록 중 최근 30개만 서버 원본을 받는다` (폰 기록 32개 모두 chunks 없음·uploadedAt 있음 → raw 요청 30번, 31·32번째는 `rawPruned: true`).
  - `지우기 목록 id 는 받지 않는다`.
  - `restoring 남은 것 지우고 다시` (기존 테스트).
  - `끝나면 계정 id 를 기억하고 다시 안 한다` / `실패가 있으면 기억하지 않는다`.
  - `로그인 없이 시작한 계정도 한다` (getAuth 만 있으면).
  - `다른 계정으로 로그인하면 그 계정으로 한 번 더`.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 받은 기록 상태는 지금처럼 `uploaded`(서버에 사본 있음 → 지우면 서버도 지움). 받은 뒤 `pruneOldRaw`. 주행 중에는 기다렸다가(지금 `untilIdle`).
- [ ] **Step 4:** PASS, 전체·tsc
- [ ] **Step 5:** 커밋 `기록 폰에만 3: 처음 한 번 서버 기록 옮기기 (원본 최근 30개 포함)`

### Task 4: 즐겨찾기·분류 폰에만 + 인기 도로 새 신호 (서버 포함)

**Files:**
- Modify: `src/app/coursePrefs.ts` (upload·syncCoursePrefs·dirty 지움, localStorage 만), `src/main.tsx` (syncCoursePrefs 부르던 곳 지움), `src/app/drive.ts` 또는 새 `src/app/droveSignal.ts` (기본 코스로 랩·편도를 1번 이상 마친 주행을 처리하면 `POST /api/drove {course: 'b:{key}'}`, 실패는 무시), `worker/src/browse.ts` (`droveSignal`, `popular` 이 `course_drives` 도 셈), `worker/src/index.ts` (경로), `worker/migrations/0012_course_drives.sql`
- Test: `test/app/coursePrefs.test.ts`(서버 맞추기 테스트 지우고 "서버를 부르지 않는다" 추가), `test/app/droveSignal.test.ts`, `worker/test/browse.test.ts`(있는 파일에 추가)

**Interfaces:**
- Produces (서버): `POST /api/drove {course: string}` → `{ok: true}`; `course` 는 `b:` 또는 `s:`(2부) + 80자 이하, 아니면 400. 표 `course_drives(user_id TEXT, course_key TEXT, day TEXT /* KST YYYY-MM-DD */, PRIMARY KEY (user_id, course_key, day))`. `popular()` 결과 꼴은 그대로 `{builtin, drivers}` (b: 만; s: 는 2부에서 넓힘), 사람 수 = `course_drives` 의 서로 다른 user_id ∪ 예전 sessions 집계 (기간 조건은 day 로).
- Produces (앱): `reportDrove(courseKey: string): void`

- [ ] **Step 1: 실패하는 테스트**
  - 서버: `drove 를 같은 날 두 번 보내도 한 줄`, `7d 인기 = 예전 세션 계정 ∪ 새 신호 계정 (같은 사람 한 번)`, `잘못된 열쇠 400`.
  - 앱: `기본 코스 주행 처리 뒤 drove 한 번, 코스 없는 주행·내 코스는 안 보냄`, `즐겨찾기 바꿔도 /api/prefs 안 부름`.
- [ ] **Step 2:** FAIL 확인 (`cd worker && npx vitest run test/browse.test.ts`)
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 앱·서버 테스트 PASS, tsc
- [ ] **Step 5:** 커밋 `기록 폰에만 4: 즐겨찾기 폰에만, 인기 도로 새 신호 /api/drove (위치 없음)`

### Task 5: 백업 파일 만들기·불러오기

**Files:**
- Create: `src/backup/backupFile.ts` (순수: 묶기·풀기·검사), `src/app/backup.ts` (폰 저장소와 잇기, 마지막 백업 기억)
- Modify: `package.json` (`fflate` 0.8.2 dependencies)
- Test: `test/backup/backupFile.test.ts`, `test/app/backup.test.ts`

**Interfaces:**
- Produces: `buildBackup(input: BackupInput): Promise<Blob>` · `readBackup(file: Blob): Promise<BackupContents>` (아니면 `Error('디고 백업 파일이 아니에요')`) · `BackupManifest = { format: 'dgo-backup'; version: 1; createdAt: number; sessions: number; courses: number }` · ZIP 안: `manifest.json`, `courses.json`, `prefs.json`, `sessions/{id}.json`(SessionRecord + DriveResultRecord + 그 기록의 RefLapRecord[]), `raw/{id}.raw.json.gz`(있을 때, `buildRawFile` + gzip — 이미 압축이라 ZIP 에선 저장만)
- `createBackupFile(): Promise<File>` (이름 `디고 백업 YYYY-MM-DD.dgo`) · `importBackup(file: File): Promise<{ sessions: number; courses: number; skipped: number }>` · `peekBackup(file: File): Promise<BackupManifest>` (확인 창용) · `lastBackup(): { at: number; bytes: number } | null` · `markBackedUp(bytes: number): void` · `backupReminderDue(now: number, sessionCount: number): boolean` · `snoozeBackupReminder(now: number): void`

- [ ] **Step 1: 실패하는 테스트**
  - `묶고 풀면 같다` (코스 2·기록 3, 그중 원본 있는 것 2 → readBackup 결과 같은 id·같은 랩, raw 2개).
  - `디고 백업 파일이 아니에요` (아무 ZIP, 깨진 바이트, manifest version 99).
  - `없는 것만 더한다`: 폰에 기록 1개 있고 백업에 3개(1개 겹침) → sessions 2, skipped 1.
  - `같은 파일 두 번 불러와도 개수 그대로`.
  - `기본 코스는 같은 기본 코스로 잇는다` (백업 코스 builtin 키 같음 → 새 코스 안 생기고 기록 courseId 가 폰의 기본 코스 id 로).
  - `같은 모양 코스는 있는 코스로` (`sameCourse`).
  - `코스 한도 넘으면 코스는 한도까지만, 나머지 기록은 코스 없이` 가 아니라 → **불러오기 전 확인에서 막는다**: `importBackup` 이 넘을 것 같으면 한도 문구로 Error, 아무것도 안 바꿈.
  - `불러온 뒤 원본은 최근 30개만`.
  - `백업 알림`: 기록 5개·마지막 백업 31일 전 → true, 29일 → false, 기록 4개 → false, 닫으면 30일 동안 false.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 묶을 때 기록마다 `zipSync` 가 아니라 `Zip` 스트림(`fflate` 의 `Zip`·`ZipPassThrough`·`ZipDeflate`)으로 조각을 이어 Blob 으로 (메모리에 한꺼번에 안 올림). 풀 때는 `unzip` 으로 충분(받은 파일 크기만큼).
- [ ] **Step 4:** PASS, 전체·tsc
- [ ] **Step 5:** 커밋 `기록 폰에만 5: 백업 파일 만들기·불러오기 (.dgo, 없는 것만 더함)`

### Task 6: 로그아웃·계정 지우기 (기록 남기기 선택)

**Files:**
- Modify: `src/app/logout.ts` (`logoutCheck` 는 주행 중·옮기는 중만 막음; `logout({ wipe }: { wipe: boolean })` — 서버 열쇠 지우기 실패해도 폰은 로그아웃; wipe 면 `clearLocalData` + `clearCoursePrefs`, 아니면 기록·코스·즐겨찾기 그대로, 그룹 방은 언제나 잊음), `src/app/deleteAccount.ts` (`deleteAccount({ wipe, reload })` — wipe 아니면 Dexie 는 남기고 계정·방·친구 관련 localStorage 만 지움; 남길 열쇠 목록을 코드 한 곳에)
- Test: 고침 `test/app/logout.test.ts`, `test/ui/deleteAccount.test.tsx`

**Interfaces:**
- Produces: `logout(opts: { wipe: boolean }): Promise<{ ok: true } | { ok: false; error: string }>` · `deleteAccount(opts: { wipe: boolean; reload?: () => void }): Promise<void>` · `KEEP_ON_ACCOUNT_DELETE: string[]` (localStorage 열쇠: 즐겨찾기 `gachitayo.coursePrefs.v1`, 설정, 마지막 백업, 도움말 알림 등)

- [ ] **Step 1: 실패하는 테스트**
  - `통신 실패해도 폰은 로그아웃, 기록 그대로` (logoutRemote 가 TypeError → ok, 기록 수 그대로, 계정 정보 없음).
  - `wipe 면 기록·내 코스·즐겨찾기 지움, 기본 코스는 남김`.
  - `업로드 대기가 있어도 막지 않는다` (예전 막음 테스트를 이걸로 바꿈).
  - `주행 중이면 막는다` (문구 "주행이나 옮기기가 끝난 뒤에 로그아웃할 수 있어요").
  - 계정 지우기: `wipe 아니면 기록 남고 계정 열쇠는 지움`, `wipe 면 전부`.
- [ ] **Step 2–5:** FAIL → 구현 → PASS·전체·tsc → 커밋 `기록 폰에만 6: 로그아웃·계정 지우기에서 기록 남기기 선택`

### Task 7: 화면 (시안 ①~⑤)

**Files:**
- Create: `src/ui/components/StorageSection.tsx`, `src/ui/components/BackupSection.tsx`, `src/ui/components/BackupNudge.tsx`
- Modify: `src/ui/screens/SettingsScreen.tsx` (SyncSection 지우고 그 자리에 StorageSection·BackupSection; 로그인 문구; 로그아웃 창 — 문구 "로그아웃해도 이 폰의 기록과 내 코스는 그대로 남아요. 친구·팀은 다시 로그인하면 돌아와요.", 체크 "기록과 내 코스도 이 폰에서 지우기", 링크 "지우기 전에 백업 파일 만들기 ›"; 계정 지우기 창 — 같은 체크, 문구 "닉네임·친구·팀·프로필 사진이 서버에서 지워지고 되돌릴 수 없어요." ; 익명 계정 안내 문구에서 "서버 기록은 남아요·자주 올려 주세요" 빼기; "통신이 연결되면 자동으로 만들고 기록을 올려요" → "… 만들어요"), `src/ui/screens/MainScreen.tsx:120-135` (업로드 대기 알림 지움), `src/ui/screens/SummaryScreen.tsx:318-345` (업로드 줄 → "이 폰에 저장됨"), `src/ui/screens/HistoryScreen.tsx` (줄에 `rawPruned` 면 " · 원본 정리됨", 맨 위 `BackupNudge`, 머리말 주석 "폰과 서버에서" 고침), `src/ui/components/RestoreBanner.tsx`(Task 3), 웹이면 저장 공간 칸에 "브라우저는 오래 안 쓰면 기록을 지울 수 있어요 · 홈 화면에 추가하거나 백업해 두세요" + `navigator.storage.persist?.()` 한 번
- Test: `test/ui/storageBackup.test.tsx`; 고침 `test/ui/SettingsScreen.test.tsx`, `test/ui/accountNotice.test.tsx`, `test/ui/settingsAccount.test.tsx`, `test/ui/MainScreen.test.tsx`, `test/ui/SummaryView.test.tsx`

**Interfaces:**
- Consumes: Task 1 `storageSummary`·`pruneOldRaw`, Task 5 백업 함수들, Task 6 `logout({wipe})`·`deleteAccount({wipe})`, `shareOrDownload` (src/storage/exportFile)

- [ ] **Step 1: 실패하는 테스트**
  - 설정: `region "저장 공간"` 에 "주행 기록 N개", "최근 30개", "N / 200"; "오래된 원본 지금 지우기"는 지울 것 없으면 disabled.
  - `region "백업"`: "전체 백업 파일 만들기" 누르면 shareOrDownload 가 `.dgo` 파일로 불림, 끝나면 "마지막 백업 …".
  - "백업 파일 불러오기" → 확인 창 "백업 파일을 불러올까요?" + "기록 N개 · 내 코스 N개" → 불러오기 → importBackup.
  - `동기화` 글자·"업로드" 글자가 설정·메인·요약 어디에도 없다 (getByText 없음).
  - 로그아웃 창: 체크 안 하면 `logout({wipe:false})`, 체크하면 `{wipe:true}`.
  - 기록 탭: rawPruned 기록 줄에 "원본 정리됨", 알림 조건이면 "마지막 백업이 30일 지났어요".
- [ ] **Step 2–4:** FAIL → 구현 → PASS·전체·tsc. Playwright 로 정식 빌드 설정·기록 탭 캡처해 시안과 비교(눈으로, 스크린샷은 커밋 안 함).
- [ ] **Step 5:** 커밋 `기록 폰에만 7: 설정 저장 공간·백업, 로그아웃 창, 기록 탭 표시 (동기화 칸 없앰)`

### Task 8: 문서·약관·기록

**Files:**
- Modify: `public/privacy.html`, `public/location-terms.html` (기록·코스는 폰에만, 서버는 계정·친구·팀·길찾기·인기 도로 신호(코스 열쇠·날짜)), `docs/release/app-store.md` (개인정보 항목: "위치"는 길찾기 때문에 남고 "기록 저장"용 설명 빼기, 심사 메모 한 줄), `src/ui/help/helpCards.ts` ("기록 · 분석" 카드에 "기록은 이 폰에만 · 설정에서 백업" 한 줄, 글 바뀌면 `test/ui/helpCards.test.ts` 맞춤), `docs/아이폰-앱-진행기록.md` 맨 위, 설계 문서 변경 이력
- [ ] **Step 1:** 고치고 `npx vitest run` · tsc 통과
- [ ] **Step 2:** 커밋 `기록 폰에만 8: 개인정보 처리방침·위치 약관·앱스토어 자료·도움말·진행기록`

## 다음 계획

2부(모두의 코스)·3부(팀 방 코스 지정)는 1부가 끝난 뒤 따로 계획 문서를 쓴다 (`docs/superpowers/plans/2026-11-19-course-share.md`, `…-team-course.md`).
