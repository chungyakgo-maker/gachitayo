# 정식 빌드 스위치 (위치 공유 끔) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 코드에서 빌드 스위치로 "위치 공유·앞 차/앞 친구 간격"을 끈 정식 빌드를 만든다 (화면 숨김 + 서버로 안 보냄).

**Architecture:** `src/features.ts`에 `locationSharing()`(지도 위치 공유)·`liveGap()`(앞 친구·앞 차 간격) 두 스위치. 빌드 값 `VITE_LOCATION_SHARING`·`VITE_LIVE_GAP` (on 기본, off). `liveGap` 기본은 `locationSharing`을 따른다. 보내기·받기를 막는 곳(friends·liveLink·group·drive)과 화면(메인·준비·주행·설정·팀 대기실·상단 칸·모의주행)이 이 두 함수만 본다. Codemagic에 정식 작업 추가.

**Tech Stack:** React 19, Vite 8, Vitest, Codemagic yaml.

**Spec:** `docs/superpowers/specs/2026-11-18-official-build-design.md`

## Global Constraints

- 기본(스위치 없음)은 지금과 완전히 같다 — 기존 테스트 전부 그대로 통과
- 정식(off·off): 다른 사람과 위치를 주고받는 요청이 하나도 없다 (presence PUT/DELETE·GET friends/presence·/live 웹소켓·팀 방 위치 보내기). 팀 방 연결(순서·간격·목적지)은 한다
- 숨김은 "업데이트 예정" 창 없이 안 보이게. 팀 주행 순서 줄은 남김(세영 결정 1)
- 앞 차·앞 친구 델타 끔, 내 베스트 랩 델타는 남김(세영 결정 3). 저장된 설정은 지우지 않고 읽을 때만 바꿈
- 정식 빌드 버전 1.0.0 (Codemagic 정식 작업에서만 MARKETING_VERSION=1.0.0, 테스트 빌드는 1.0 그대로)

## Review Focus

- 예전에 "친구 델타"·"앞 친구 간격" 칸을 골라 둔 사람: 정식에서 빈칸·오류 없이 베스트 델타·표시 안 함
- 예전에 앞 친구(friendId)를 골라 둔 상태로 주행 시작: 정식에서 /live 연결 없음
- 팀 주행 중 방장 차 간격 바꾸기: 정식에서도 대기실·순서·목적지 동작
- liveGap만 켠 빌드(나중 대비): 지도에 남의 차·친구 점은 없고 간격만
- 설정 하단에 "정식"/"테스트" 표시

---

### Task 1: 스위치 + 보내기·받기 막기
**Files:** Create `src/features.ts`; Modify `src/vite-env.d.ts`, `src/app/friends.ts`, `src/app/liveLink.ts`, `src/app/drive.ts`, `src/app/group.ts`, `src/app/settings.ts`(effectiveSettings); Test `test/app/officialBuild.test.ts`
**Interfaces:** `locationSharing(): boolean`, `liveGap(): boolean`, `buildChannel(): '정식' | '테스트'`, `effectiveSettings(s: Settings): Settings` (테스트는 `setFeaturesForTest` 대신 `vi.stubEnv`로 값을 바꾼다. `drive.ts`는 liveLink 안에서 막혀 고치지 않음)
- [ ] 실패 테스트: 끄면 setSharing(true)이 fetch 안 함·sharing false, watchFriendPositions fetch 안 함, startLiveLinks 웹소켓 안 엶, 팀 방에서 GPS 안 보냄·pos 버림, effectiveSettings가 friend→best·gap→none; 켜면 지금과 같음
- [ ] 구현·통과·커밋

### Task 2: 화면 숨김 + 빌드 표시
**Files:** Modify MainScreen, PrepareScreen, DriveScreen, SettingsScreen, FriendsSection, GroupScreen, WidgetsScreen, ReplayScreen; Test `test/ui/officialBuild.test.tsx`
- [ ] 실패 테스트: 끄면 위치 공유 단추·카드·친구 위치 토글·앞 친구 간격·가상 친구·"앞 친구 간격" 칸 없음, 친구 "공유 중" 글자 없음, 대기실 "권장 차 간격 (안내)", 설정 하단 "정식"
- [ ] 구현·통과·커밋

### Task 3: Codemagic 정식 작업 + 문서
**Files:** `codemagic.yaml`(ios-release: off·off, MARKETING_VERSION=1.0.0), `test/style/iosConfig.test.ts`, 설계 문서 결정 반영, 진행기록
- [ ] 실패 테스트(yaml에 정식 작업·스위치 off·1.0.0), 구현, 전체 확인, 커밋·푸시(app-login)
