# 커브 표지판 (페이스노트) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코스를 골라 달릴 때(모의주행 포함) 지도 모드 위쪽 칸 아래 정가운데에 다음 커브 표지판(방향 색·숫자 등급·모양 화살표·남은 거리·붙는 말·이어서)을 띄우고, 나침반 보기 이름을 없애고 나침반·GPS 아이콘을 32 px로 줄인다.

**Architecture:** `engine/course/paceNotes.ts`(순수)가 코스 중심선에서 커브 목록을 만들고, `upcomingNote`가 지금 코스 위치(LiveState.s)로 다음 커브와 남은 거리를 고른다. 화면은 `PaceNoteSign`(SVG)과 `PaceNoteHud`(표지판 + 거리 + 이어서)를 DriveView 지도 모드에 얹고, 표지판 자리만큼 LiveMap 위쪽 여백을 늘린다.

**Tech Stack:** TypeScript strict, React 19, Vitest (core/ui).

**Spec:** `docs/specs/2026-11-12-gachitayo-phase1-spec.md` 8.4 "커브 표지판", 변경 이력 2026-11-13.

## Global Constraints

- 한국어 글·주석·커밋, 커밋 끝 두 줄(Co-Authored-By / Claude-Session).
- 곡률 창 20 m, 커브 문턱 |k| ≥ 1/300, 같은 방향 15 m 안 합침, 총 회전 20° 미만 버림.
- 등급 R: 1 <20, 2 20–30, 3 30–45, 4 45–65, 5 65–100, 6 ≥100 (m). 헤어핀 ≥135° 이고 R<30. 스퀘어 70–110°, R<15, 길이<30 m.
- 붙는 말: 뒤 1/3 R < 앞 1/3 R × 0.65 → 조여짐, 반대 → 풀림, 아니면 길이 ≥100 m·등급 3 이상 → 길게.
- 보임: 앞에서 시작하는 첫 커브가 250 m 안. 이어서: 다음 커브 시작이 이 커브 끝에서 30 m 안. 거리는 10 m 단위(최소 10).
- 색: 왼쪽 #aacae6 / 글자 #0d1a26, 오른쪽 #f4a7a3 / 글자 #3b0f0d. 숫자는 위쪽 정가운데.
- 나침반·GPS 아이콘 32 px, 같은 높이(top: ins.top + 10). 나침반 옆 글자 없음(aria-label은 유지).

## Review Focus

1. 랩 코스 끝 → 처음 커브로 이어짐(거리 계산이 음수·빈칸이 되지 않게) → Task 1 시험.
2. 코스 위치를 모를 때(s null) 표지판 없음, 오류 없음 → Task 3 시험.
3. GPS 점이 듬성한 카카오맵 경로(꺾은선)에서 꼭짓점마다 가짜 커브가 생기지 않게 → Task 1 기본 코스 시험(1 km당 개수 범위).
4. 곧은 길의 작은 흔들림(±0.3 m)에는 표지판 없음 → Task 1 시험.
5. 표지판이 생겨도 메인 지도 GPS 버튼 크기는 그대로(주행 화면만) → Task 3 CSS 범위.

---

### Task 1: 커브 찾기·등급 (engine)

**Files:** Create `src/engine/course/paceNotes.ts`; Test `test/engine/course/paceNotes.test.ts`

**Interfaces:**
- `type PaceGrade = 1 | 2 | 3 | 4 | 5 | 6 | 'H' | 'S'`
- `interface PaceNote { s0: number; s1: number; dir: 'left' | 'right'; grade: PaceGrade; mod: '조여짐' | '풀림' | '길게' | null; angleDeg: number; radiusM: number }`
- `paceNotes(cl: Polyline): PaceNote[]` (s0 오름차순)
- `interface UpcomingNote { note: PaceNote; distM: number; then: PaceNote | null }`
- `upcomingNote(notes: PaceNote[], s: number, opts: { lengthM: number; loop: boolean; maxDistM?: number }): UpcomingNote | null` (기본 maxDistM 250, distM은 10 m 단위 반올림·최소 10)

- [ ] 시험: 직선+왼쪽 R35 90°+직선 → 1개(왼쪽, 3, 각 90±12, s0 200±20); 오른쪽 R80 60° → 오른쪽 5; R12 180° → 'H'; 90° 꼭짓점 → 'S'; R60 40°→R25 50° → 조여짐, 반대 → 풀림; R70 120° → 길게; ±0.3 m 흔들린 직선 → []; 기본 코스 11개 모두 1 km당 1~15개, 말티재 헤어핀 5개 이상. upcomingNote: 앞 커브·거리, 커브 안이면 다음 커브, 250 m 밖 null, 이어서(30 m 안), 랩 코스 끝에서 처음으로.
- [ ] FAIL 확인 → 구현 → PASS → 커밋

### Task 2: 표지판·표지판 칸 (UI 부품)

**Files:** Create `src/ui/components/PaceNoteSign.tsx`, `src/ui/components/PaceNoteHud.tsx`; Modify `src/ui/styles.css`; Test `test/ui/paceNote.test.tsx`

**Interfaces:**
- `PaceNoteSign({ dir, grade, mod, size }: { dir: 'left' | 'right'; grade: PaceGrade; mod?: PaceNote['mod']; size?: number })` — `svg[role=img]`, aria-label `왼쪽 3`, `오른쪽 헤어핀 조여짐` 식. 위쪽 정가운데 글자(숫자 또는 헤어핀·스퀘어). 화살표는 시안(`scratchpad/pacenote/sign.js`)의 구간 방식 그대로.
- `PaceNoteHud({ up, style }: { up: UpcomingNote | null; style?: CSSProperties })` — `div.pace-hud[aria-live=polite]`. up이 null이면 빈 칸. 큰 표지판 96 px + `.pn-dist`(`30m`) + `.pn-mod`, then이 있으면 `.pace-next`에 "이어서" + 54 px 표지판.
- 상수 `PACE_HUD_RESERVE_PX = 146` (표지판 96 + 간격 6 + 거리 칸 26 + 위 10 + 여유 8).

- [ ] 시험: 표지판 aria-label·글자(3 / 헤어핀), 왼쪽 배경 #aacae6·오른쪽 #f4a7a3; 칸에 `30m`, `조여짐`, `이어서`+작은 표지판; up null이면 표지판 없음.
- [ ] FAIL → 구현 → PASS → 커밋

### Task 3: 주행 화면에 붙이기 + 나침반·GPS 32 px

**Files:** Modify `src/ui/screens/DriveScreen.tsx`, `src/ui/components/MapViewButton.tsx`, `src/ui/styles.css`; Test `test/ui/DriveView.test.tsx`

- DriveView 지도 모드: `useMemo`로 코스 → `buildGeometry(course).centerline` → `paceNotes` (없으면 []). `st?.s`가 숫자면 `upcomingNote(notes, st.s, { lengthM: centerline.length, loop: course.kind === 'loop' })`. `PaceNoteHud`를 `top: ins.top + 10`, 가로 가운데. 커브가 하나라도 있으면 LiveMap `insetTop = ins.top + PACE_HUD_RESERVE_PX`.
- MapViewButton: `.name` 글자 없앰(aria-label 그대로), 바늘 svg 20 px, N 위치 조정. CSS `.map-compass .dial` 32 px. GpsIcon top `ins.top + 10`, `.drive .map-gps` 32 px(svg 18 px) — 메인 지도는 그대로.
- [ ] 시험: 커브가 있는 코스·s가 커브 앞이면 `왼쪽 …` 표지판과 거리; s null이면 없음; 나침반 버튼에 보기 이름 글자 없음(aria-label은 있음).
- [ ] FAIL → 구현 → 전체 시험·타입 검사 → 커밋

### Task 4: 확인·배포

- [ ] 모의주행(하오고개, 말티재)으로 표지판이 커브마다 바뀌는지, 나를 가운데 보기에서 차가 안 가려지는지 화면을 찍어 확인.
- [ ] 최종 검토(새 검토자) → 고칠 것 고침 → main에 올려 CI·배포 확인 → 한국어 보고.
