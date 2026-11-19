# 3부: 팀 방 코스 지정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀(그룹) 방에서 방장이 목적지 대신 코스를 정하면, 팀원이 "이 코스로 진행"으로 받아 폰에 담고, 출발하면 각자 위치에서 출발점까지 안내받은 뒤 출발선부터 같은 코스로 랩을 잰다.

**Architecture:** 방(Durable Object)에 코스 요약(`course`)과 코스 모양(저장소 `course`, 줄인 선 + 출발선·도착선)을 더한다. 코스를 정하면 방은 목적지를 "코스 이름 · 출발점"(출발선 위치)으로 같이 채우고 판(routeVersion)을 올린다 — 예전 앱(1.0.0)은 출발점 목적지로 받는다. 앱은 판이 바뀌면 코스 모양을 받아 묻고, 받으면 폰의 코스(기본 코스 열쇠·공개 번호·같은 모양 순으로 찾고, 없으면 새로)로 이어 출발 때 그 코스를 고른다.

**Tech Stack:** TypeScript, React 19, Vitest, Cloudflare Durable Objects.

**Spec:** `docs/superpowers/specs/2026-11-18-local-records-course-share-design.md` 3부. 시안 `docs/mock/2026-11-18-course-share.jpg` ⑨⑩.

## Global Constraints

- 서버는 더하기만: `/api/rooms/{id}/course` (POST 방장만, GET 참가자) 를 더하고, 방 상태에 `course`(없으면 null) 칸을 더한다. 예전 앱이 아는 `dest`·`routeVersion`·`/route` 는 그대로 쓰인다.
- 코스 모양 검사: 이름 1~40자, 종류 loop|point_to_point, 길이 0 이상 100 km 이하, 게이트 값, 선 0점 또는 2~3000점, 열쇠는 null 또는 `b:`·`s:` 로 시작하는 80자 이하.
- 정식 빌드: 방장 위치를 보내지 않는다 — 코스 모양(출발선·선)만 보내고 길은 각자 찾는다(목적지만 담은 경로 `destOnlyRoute`).
- 문구: 대기실 칸 이름 "이번 주행 · 방장이 정해요", 칸 [목적지 | 코스], 코스면 "출발하면 각자 출발점까지 안내, 출발선부터 기록". 팀원 창 제목 "방장이 코스를 정했어요", "모두 같은 출발선·도착선", "받으면 내 폰에 담기고, 출발하면 지금 위치에서 출발점까지 안내해요", 단추 "이 코스로 진행"/"나중에".
- 매 작업 끝 `npx tsc --noEmit -p .`·`npx vitest run` (서버는 `cd worker && npx tsc --noEmit -p . && npx vitest run`).

## Review Focus

1. 예전 앱(코스를 모름)이 같은 방에 있어도 출발점 목적지를 받는다 → Task 1 `코스를 정하면 dest 가 출발점, route 는 목적지만`.
2. 방장이 코스 → 목적지로 바꾸면 코스가 비워지고 팀원은 목적지로 다시 묻는다 → Task 1·2 테스트.
3. 팀원이 이미 같은 코스(기본 코스·받은 공개 코스·같은 모양)를 갖고 있으면 새로 담지 않는다 → Task 2.
4. 코스 한도(200)면 받기에서 문구로 알리고 방은 그대로 → Task 2.
5. 주행 중에 방장이 코스를 바꾸면 지금 주행의 코스는 바꾸지 않는다(다음 출발부터) → Task 2.

---

### Task 1: 서버 — 방 코스 정하기·받기

**Files:** Modify `worker/src/group.ts` (RoomData `course: RoomCourseMeta | null`, `setCourse`, `courseShape`, `setDest` 가 course 비움, `roomAction` 'course', `roomCourse`), `worker/src/index.ts` (경로 `course`), Test `worker/test/group.test.ts`

**Interfaces:** `RoomCourseMeta = { name, kind, lengthM, key: string | null }` · `RoomCourse = RoomCourseMeta & { startGate, finishGate, sectorBoundsM, line: Array<[lat, lon]> }` · `POST /api/rooms/{id}/course RoomCourse` → 방 상태 · `GET /api/rooms/{id}/course` → `RoomCourse & { version }` | null

- [ ] 실패하는 테스트: `방장만 코스를 정한다(남 403)`, `코스를 정하면 상태에 course 요약, dest 는 "이름 · 출발점"(출발선 위치), routeVersion +1, /route 는 목적지만(거리 0)`, `GET /course 는 참가자만, 모양과 판`, `목적지를 정하면 course 가 null`, `잘못된 선·이름·열쇠 400`.
- [ ] FAIL → 구현 → PASS·tsc → 커밋 `팀 방 코스 1: 서버 코스 정하기·받기 (예전 앱은 출발점 목적지)`

### Task 2: 앱 상태 — 코스 제안·받기·출발

**Files:** Modify `src/app/group.ts` (GroupRoomState `course`, GroupOffer `course?: RoomCourse`, `checkRoute` 가 코스면 `/course` 를 받음, `applyOffer` 가 코스를 폰에 이음, `startGroupNav` 가 코스면 `chooseCourse` + 출발점까지 목적지만 경로, `shareGroupCourse(c: Course)`), Create `src/app/teamCourse.ts` (`courseForRoom(c: RoomCourse): Promise<Course>` — 찾기·담기, `roomCourseBody(c: Course): RoomCourse`), `src/types/course.ts` (`CourseSource` 'team'), `CourseDetailScreen` SOURCE 'team' = '팀 방에서 받음'; Test `test/app/group.test.ts`, `test/app/teamCourse.test.ts`

- [ ] 실패하는 테스트: `코스 판이면 /course 를 받아 묻는다 (offer.course)`, `받으면 폰에 담고(같은 기본 코스면 그 코스), startGroupNav 가 그 코스를 고르고 출발점까지 목적지만 경로로 안내`, `코스 한도면 offer 에 오류 문구, 방은 그대로`, `주행 중 바뀐 코스는 지금 주행에 안 넣는다`, `방장: shareGroupCourse 가 줄인 선·열쇠를 보낸다`, `courseForRoom: b: 열쇠·s: 공개 번호·같은 모양 → 있는 코스, 없으면 source 'team' 새 코스`.
- [ ] FAIL → 구현 → PASS·tsc → 커밋 `팀 방 코스 2: 앱 코스 제안·받기·출발`

### Task 3: 화면 — 대기실 "이번 주행" 칸 · 방장 코스 고르기 · 팀원 받기 창 (시안 ⑨⑩)

**Files:** Modify `src/ui/screens/GroupScreen.tsx` (칸), Create `src/ui/screens/GroupCourseScreen.tsx` (`#/group/course`: 분류 칩(전체·기본 코스·모두의 코스·즐겨찾기·내 코스)과 폰의 코스 목록, 고르면 `shareGroupCourse` 후 `#/group`), Modify `src/ui/components/RouteOfferSheet.tsx` (코스 제안이면 코스 창: 작은 지도·이름·종류·길이·문구), `src/ui/App.tsx`; Test `test/ui/groupCourse.test.tsx`

- [ ] 실패하는 테스트: `대기실: 코스가 정해졌으면 [목적지|코스] 중 코스가 눌린 상태 + 코스 이름 + 안내 문구, 방장은 "코스 바꾸기"(→ #/group/course), 칸 "목적지" 누르면 #/group/destination`, `방장 코스 고르기: 줄을 누르면 shareGroupCourse(그 코스) 후 #/group`, `팀원 창: 제목·문구·"이 코스로 진행"→acceptRouteOffer, "나중에"→dismissRouteOffer, 받기 실패 문구`.
- [ ] FAIL → 구현 → PASS·tsc. 정식 빌드 대기실을 찍어 시안 ⑨와 비교(커밋 안 함).
- [ ] 커밋 `팀 방 코스 3: 대기실 이번 주행 칸·방장 코스 고르기·팀원 받기 창`

### Task 4: 문서

`docs/release/app-store.md`(심사 메모 팀 주행 줄에 코스), `src/ui/help/helpCards.ts`(팀 주행 카드 한 줄, 3줄 유지), 개인정보 처리방침 팀 방 항목(방장이 정한 코스 모양), `docs/아이폰-앱-진행기록.md`, 설계 변경 이력 → 커밋 `팀 방 코스 4: 문서`
