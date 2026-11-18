# 팀 · 팀 주행 · 프로필 사진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 친구로 만든 팀(최대 5개, 15명)으로 팀 주행을 열고 들어가며, 26px 프로필 사진을 친구·팀원에게 보여 준다.

**Architecture:** D1 `teams`·`team_members` 표와 `users.avatar`를 더하고, 팀 주행은 지금 GroupRoom(방) Durable Object를 팀 방으로 재사용한다(코드 방 API는 그대로). 앱은 `teams.ts`·`avatar.ts`를 더하고 기존 대기실·주행 화면을 팀 이름·프사로 넓힌다.

**Tech Stack:** Cloudflare Worker + D1 + R2 + Durable Objects (vitest-pool-workers), React 19 + Vite + Vitest + Testing Library, Capacitor 8.

**Spec:** `docs/superpowers/specs/2026-11-18-team-drive-design.md`

## Global Constraints

- 팀은 내가 속한 팀 전체 최대 5개(`TEAM_MAX = 5`), 한 팀 나 포함 15명(`TEAM_SIZE = 15`), 팀 이름 1~20자
- 팀원은 친구에서만, 넣으면 바로 팀원. 팀장 = 만든 사람
- 코드 방 최대 8명 그대로, 팀 방 15명. 색은 8가지 중 가장 적게 쓴 색
- 프사: 160×160 JPEG, 서버는 100KB까지·JPEG 머리(FF D8 FF) 확인, R2 `avatars/{id}.jpg`, `GET /avatar/{id}.jpg`
- 지금 배포된 웹·TestFlight를 깨지 않는다: `/api/rooms`·`/api/rooms/join` 유지, 응답에는 칸을 더하기만
- 주석·화면 글은 한국어, 사용자 말은 따옴표로 남긴다

## Review Focus

- 친구를 끊은 뒤 팀 편집 저장: 이미 팀원인 사람은 친구가 아니어도 남는다(새로 넣을 때만 친구 확인)
- 팀 주행 방이 24시간·전원 나감으로 닫힌 뒤 다시 "팀 주행": 새 방을 연다(죽은 방 id로 404 안 남)
- 팀에서 빠진 사람이 예전 알리기 링크·남은 방으로 들어오기: 팀원 아니면 403
- 15명 방에서 색: 9번째부터 색이 겹쳐도 undefined가 아니다
- 프사 없는 사람·사진이 아닌 파일: 첫 글자 동그라미, 서버 400

---

### Task 1: 서버 — 프사 + 친구 칸 + 탈퇴 정리

**Files:**
- Create: `worker/migrations/0011_teams.sql` (teams, team_members, users.avatar)
- Create: `worker/src/avatar.ts`
- Modify: `worker/src/index.ts` (`/avatar/{id}.jpg`, `/api/me/avatar`), `worker/src/friends.ts` (listFriends에 avatar·full), `worker/src/data.ts` (getMe avatar, deleteAccount)
- Test: `worker/test/teams.test.ts`

**Interfaces:**
- Produces: `putAvatar(env, userId, body: ArrayBuffer): Promise<{avatar: string}>`, `deleteAvatar(env, userId)`, `getAvatar(env, id): Promise<Response>`; 친구 행 `{userId, nickname, since, sharing, avatar: string|null, full: boolean}`

- [ ] 실패 테스트: JPEG 올리기 → `/api/me`·친구 목록에 avatar, `GET /avatar/{id}.jpg` 200 image/jpeg; PNG·빈 본문·100KB 넘음 → 400; 지우기 → null·옛 주소 404; 친구가 팀 5개면 `full: true`; 탈퇴하면 프사 파일 404
- [ ] 구현, 테스트 통과, 커밋

### Task 2: 서버 — 팀 API + 팀 방

**Files:**
- Create: `worker/src/teams.ts`
- Modify: `worker/src/group.ts` (RoomData `teamId`·`teamName`·`max`, Member `avatar`, 팀 순서 자리, 색, 빈 방 닫기, `summary()`), `worker/src/index.ts` (`/api/teams…`), `worker/src/data.ts` (탈퇴: 내 팀 지우기)
- Test: `worker/test/teams.test.ts`, `worker/test/group.test.ts`

**Interfaces:**
- Produces: `GET /api/teams` → `{teams: Team[]}`, `Team = {id, name, ownerId, members: {userId, nickname, avatar}[], gapS, drive: {roomId, count} | null}`; `POST /api/teams {name, memberIds}` → Team; `PUT /api/teams/{id}`; `DELETE /api/teams/{id}`; `POST /api/teams/{id}/leave`; `POST /api/teams/{id}/drive` → `{roomId}`; 방 상태에 `teamId: string|null`, `teamName: string|null`, `max`, 참가자 `avatar`

- [ ] 실패 테스트: 만들기(친구 아님 400, 16명 400, 6번째 팀 409, 가득 찬 친구 409), 목록, 편집(팀장만 403), 나가기(팀장 400), 지우기, 팀 주행 열기 → 같은 방으로 둘째 사람 들어감·연 사람 방장·팀 아님 403, 방장 순서·간격 → 다음 주행에 그대로, 전원 나가면 다시 열 때 새 방, 15명 방 색
- [ ] 구현, 테스트 통과, 커밋

### Task 3: 앱 — 상태 (teams·avatar·group)

**Files:**
- Create: `src/app/teams.ts`, `src/app/avatar.ts`
- Modify: `src/app/group.ts` (`teamId`·`teamName`, 참가자 `avatar`, `enterGroupRoom(roomId)`), `src/app/friends.ts` (Friend `avatar`·`full`), `src/app/account.ts` (내 avatar)
- Test: `test/app/teams.test.ts`

**Interfaces:**
- Produces: `useTeams(): {teams: Team[]; loaded: boolean}`, `loadTeams()`, `createTeam(name, memberIds)`, `updateTeam(id, {name?, memberIds?})`, `deleteTeam(id)`, `leaveTeam(id)`, `openTeamDrive(id): Promise<void>` (방 열기까지), `watchTeams(): () => void` (30초); `squareJpeg(file: Blob, size = 160): Promise<Blob>`, `uploadAvatar(file)`, `removeAvatar()`, `avatarUrl(id: string|null): string|null`
- [ ] 실패 테스트(가짜 fetch), 구현, 통과, 커밋

### Task 4: 앱 — 화면

**Files:**
- Create: `src/ui/components/Avatar.tsx`, `src/ui/components/TeamSheet.tsx`, `src/ui/screens/TeamEditScreen.tsx`, `src/ui/components/FriendInviteSheet.tsx`, `src/ui/components/ProfilePhoto.tsx`
- Modify: `DriveChoiceSheet.tsx`("팀 주행"), `MainScreen.tsx`(팀 흐름·알림), `GroupScreen.tsx`(팀 대기실), `App.tsx`(경로 `#/team/new`·`#/team/{id}`·`#/team/{id}/drive`·`#/friend/{code}`), `FriendsSection.tsx`(프사·카톡 친구 초대), `SettingsScreen.tsx`(내 프로필 사진·팀 카드), `src/app/kakaoShare.ts`(친구 초대·주행 알리기 카드), `styles.css`
- Test: `test/ui/team.test.tsx`
- [ ] 실패 테스트: 팀 0·1·여러 개 흐름, 팀 만들기 15명·가득 찬 친구 막힘, 대기실 팀 이름·안 들어온 팀원·방 코드 없음, 프사 없으면 첫 글자, 친구 초대 링크
- [ ] 구현, 통과, 커밋

### Task 5: 마무리

- Modify: `ios/App/App/Info.plist`(NSCameraUsageDescription·NSPhotoLibraryUsageDescription), `public/privacy.html`(프로필 사진·팀), 사양서 14장, `docs/아이폰-앱-진행기록.md`
- [ ] `npm run typecheck`, `npx vitest run`, `cd worker && npx vitest run` 모두 통과
- [ ] 브라우저에서 화면 확인(가짜 서버), app-login 커밋·푸시 (배포는 세영에게 묻는다)
