# 카카오 로그인 + 기록 되살리기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카카오로 로그인·연결·합치기를 하고, 새 폰에서 서버 원본으로 기록·코스를 되살린다.

**Architecture:**
- Worker(`gachitayo-api`)가 카카오 REST 로그인을 대신한다.
  - 앱은 verifier 해시를 넣어 시작하고, 돌아온 6자리 번호(pin)와 verifier로 마친다.
  - 마치기에서만 계정을 바꾼다(연결·새로 만들기·합치기).
- 되살리기는 앱의 `restore.ts`가 한다.
  - 서버 목록과 폰을 비교해 없는 기록은 원본을 받아 다시 계산한다.
  - 폰에만 있는 기록은 올린다.

**Tech Stack:**
- React 19 · TypeScript · Vite · Vitest (ui = jsdom, core = node) · Dexie(IndexedDB)
- Cloudflare Workers · D1 · R2 · `@cloudflare/vitest-plugin`

**Spec:** `docs/superpowers/specs/2026-11-13-kakao-login-design.md`

## Global Constraints

- **화면 글은 한국어.** 카카오 버튼은 노랑 `#FEE500`, 글자는 검정(85%), "카카오로 시작하기"·"카카오로 로그인".
- **받는 정보는 카카오 회원번호와 닉네임만.** 닉네임은 앞뒤 공백을 빼고 코드포인트 20자까지, 비면 "드라이버".
- **state:** 무작위 128비트 이상, 10분 유효, 한 번만 쓴다. **pin:** 6자리, 5번 틀리면 그 로그인 끝. verifier는 해시만 저장.
- **폰 열쇠는 URL에 넣지 않는다.** Worker 로그에 회원번호·닉네임·위치를 찍지 않는다.
- **returnTo:** `env.ALLOWED_ORIGIN + '/'`로 시작해야 한다. 열린 리다이렉트 금지.
- **남용 방지:**
  - 로그인 시작: 같은 IP에서 1시간 30번.
  - 카카오로 새 계정 만들기: 기존 가입 제한(같은 IP 1시간 10개)을 같이 쓴다.
- **건드리지 않을 것:** Supabase 두 프로젝트, 청약고·메리고 Cloudflare 자원과 카카오 앱.
- **비밀값:** GitHub Secrets `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET` → Worker 비밀값. 둘 다 있을 때만 카카오를 켠다.
- **리다이렉트 URI:** `<Worker 주소>/auth/kakao/callback`. 요청 주소의 origin으로 만든다.
- **커밋 꼬리:**
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_016MogDNvNcourc5GYJT713m`
- **명령:**
  - 노드 경로: `export PATH=/opt/node24/bin:$PATH`
  - 앱 테스트: 저장소 루트에서 `npx vitest run`
  - Worker 테스트: `worker/`에서 `npx vitest run`
  - 타입: 루트 `npx tsc -b` / `worker/`에서 `npx tsc --noEmit`

## Review Focus

1. **카카오 화면에서 뒤로 가기나 창 닫기로 로그인을 끝내지 않음.** 진행 중 표시는 10분 뒤 사라지고, 취소 버튼으로 바로 지울 수 있어야 한다. → Task 5 테스트 `pending login expires and can be cancelled`.
2. **카카오 닉네임이 20자 넘음, 이모지, 빈 값.** 잘리거나 "드라이버"가 되고 400이 나면 안 된다. → Task 2 테스트 `nickname from kakao is trimmed to 20 code points or 드라이버`.
3. **되살리기 중 통신이 끊기거나 서버가 500.** 받은 것은 남고, 다음 실행 때 같은 기록이 두 번 생기지 않는다. → Task 6 테스트 `restore resumes without duplicates after a failure`.
4. **주행 중이거나 되살리는 중에 로그아웃.** 막아야 한다. → Task 7 테스트 `logout is blocked while recording or restoring`.
5. **같은 state로 마치기를 두 번(두 창·빠른 두 번 탭).** 한 번만 열쇠가 나온다. → Task 2 테스트 `finish works once per state`.

---

### Task 1: 서버 표 0003 + 여러 기기 열쇠 + 로그아웃 + providers + /api/me 연결 여부

**Files:**
- Create: `worker/migrations/0003_identities.sql`
- Modify: `worker/src/auth.ts`, `worker/src/data.ts` (getMe), `worker/src/index.ts` (라우트·머리 주석), `worker/src/env.d.ts`, `worker/vitest.config.ts` (테스트 비밀값 바인딩)
- Test: `worker/test/kakao.test.ts` (새 파일. Task 2·3도 여기에)

**Interfaces:**
- Produces:
  - 표
    - `identities(provider, subject, user_id, created_at)`. PK `(provider, subject)`, UNIQUE `(user_id, provider)`, `ON DELETE CASCADE`.
    - `user_tokens(token_hash PK, user_id, created_at)`.
    - `oauth_states(state PK, verifier_hash, user_id NULL, return_to, ip, created_at INTEGER, kakao_id NULL, kakao_nickname NULL, pin_hash NULL, tries INTEGER NOT NULL DEFAULT 0)`. 인덱스 `(ip, created_at)`.
    - `ALTER TABLE courses ADD COLUMN builtin TEXT`.
  - 함수
    - `authenticate()`는 `users.token_hash` 다음으로 `user_tokens.token_hash`도 찾는다.
    - `issueToken(env, userId): Promise<string>`: 무작위 열쇠를 만들고 해시를 `user_tokens`에 넣는다(auth.ts).
    - `logout(env, token): Promise<void>`
  - 라우트
    - `GET /api/me` → `{userId, nickname, kakao: boolean}`
    - `POST /auth/logout` → `{ok: true}`
    - `GET /auth/providers` → `{kakao: boolean}`
  - `env.KAKAO_REST_API_KEY?: string`, `env.KAKAO_CLIENT_SECRET?: string`

- [ ] **Step 1: 실패하는 테스트**
  - `kakao.test.ts`에 `describe('여러 기기 열쇠·로그아웃·providers')`를 만든다.
  - `user_tokens` 열쇠: `issueToken`으로 만든 열쇠로 `GET /api/me`가 200이고 `kakao: false`.
  - 로그아웃:
    - `POST /auth/logout` 뒤 그 열쇠로 `/api/me`가 401이고, 같은 계정의 다른 열쇠는 여전히 200.
    - 첫 익명 열쇠(`users.token_hash`)로 로그아웃하면 그 열쇠도 401이 된다.
  - `GET /auth/providers`: 테스트 바인딩에 두 값이 있으면 `{kakao:true}`.
  - `GET /api/me`: identities 행을 직접 넣으면 `kakao: true`.
- [ ] **Step 2: 실행해 실패 확인** — `cd worker && npx vitest run test/kakao.test.ts` → 404 또는 401로 실패.
- [ ] **Step 3: 구현**
  - 마이그레이션, auth·data·index.
  - `vitest.config.ts` bindings에 `KAKAO_REST_API_KEY: 'test-rest-key'`, `KAKAO_CLIENT_SECRET: 'test-secret'`를 넣는다.
  - 로그아웃: `user_tokens` 행을 지운다. 첫 열쇠면 `users.token_hash`를 `sha256Hex(무작위)`로 바꾼다.
- [ ] **Step 4: 통과 확인** — 같은 명령으로 kakao.test 전체가 통과하고, 기존 api/friends/live/map 테스트도 통과.
- [ ] **Step 5: 커밋**

### Task 2: 카카오 시작·콜백·마치기 (연결·새로 만들기·로그인·전환)

**Files:**
- Create: `worker/src/kakao.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/kakao.test.ts`

**Interfaces:**
- Consumes: Task 1의 표, `issueToken`, `signup` 가입 제한 로직(같은 IP 1시간 10개를 세는 부분은 함수로 빼서 같이 쓴다: `checkSignupLimit(env, ip, now)`).
- Produces:
  - `POST /auth/kakao/start {returnTo, verifierHash}` (+선택 Bearer) → `{url}`
    - 카카오 비밀값이 없으면 503.
    - returnTo가 틀리면 400, IP 제한이면 429.
    - verifierHash는 64자 hex.
  - `GET /auth/kakao/callback?code&state`
    - 정상: 302 `Location: <returnTo 해시 앞부분>#/auth/kakao?state=S&pin=NNNNNN`
    - 카카오가 `error`를 주면: 302 `…#/auth/kakao?state=S&error=cancelled`(access_denied) 또는 `error=failed`
    - state를 모르거나 만료면: 400 HTML(`text/html; charset=utf-8`) "로그인 시간이 지났어요. 앱에서 다시 시도해 주세요".
  - `POST /auth/kakao/finish {state, verifier, pin}` (+시작 때 B가 있었으면 B의 Bearer 필수)
    - 성공: `{userId, token, nickname, kind}`. `kind ∈ 'created'|'linked'|'login'|'merged'|'switched'`.
    - 실패: 400 잘못된 값, 403 verifier·pin·열쇠 불일치(tries+1, 5번째면 state 삭제), 410 만료·없음.
  - `kakao.ts`
    - `kakaoAuthorizeUrl(env, redirectUri, state): string`
    - `fetchKakaoUser(env, code, redirectUri): Promise<{id: string; nickname: string}>`
      - 안에서 `fetch('https://kauth.kakao.com/oauth/token', {method:'POST', form: grant_type=authorization_code, client_id, redirect_uri, code, client_secret})`
      - 그다음 `fetch('https://kapi.kakao.com/v2/user/me', {headers:{Authorization:'Bearer …'}})`
      - 닉네임은 `kakao_account.profile.nickname ?? properties.nickname`.
    - `kakaoNickname(raw: unknown): string`: 20 코드포인트, 비면 '드라이버'.
- 합치기(`merged`)는 이 Task에서는 `throw new HttpError(501)` 자리만 두고 Task 3에서 채운다. 그 줄 테스트는 Task 3.

- [ ] **Step 1: 실패하는 테스트**
  - 준비: `vi.spyOn(globalThis, 'fetch')`로 카카오 두 주소를 가짜로 바꾼다(회원번호·닉네임을 테스트마다 정함).
  - 도우미 `login({token?, kakaoId, nickname})`: start → state를 URL에서 꺼냄 → callback → Location에서 pin 꺼냄 → finish.
  - 테스트:
    - `start returns kakao authorize url with state and redirect uri`
      - url이 `https://kauth.kakao.com/oauth/authorize?`로 시작한다.
      - `client_id=test-rest-key`, `redirect_uri=https://api.example.workers.dev/auth/kakao/callback`, `response_type=code`, `state`가 들어 있다.
    - `start rejects returnTo outside allowed origin` → `https://evil.example/`면 400.
    - `start without kakao secrets is 503`: env 복사본에서 키를 빼고 `handle(req, {...env, KAKAO_REST_API_KEY: undefined})`.
    - `callback alone does not change accounts`
      - 익명 B로 start → callback까지만 한다.
      - identities 행이 0이고, B의 `/api/me`가 `kakao:false`.
    - `new kakao without account creates user` → kind `created`, 닉네임은 카카오 닉네임, 새 열쇠로 `/api/me` 200 `kakao:true`.
    - `new kakao with anonymous B links B` → kind `linked`, userId === B, 닉네임은 B의 것 그대로.
    - `known kakao without account logs in` → 같은 회원번호로 두 번째 로그인하면 kind `login`, 같은 userId.
    - `known kakao from linked other account switches` → kind `switched`.
    - `finish needs B token when started with B` → Bearer 없이 finish하면 403.
    - `wrong verifier or pin counts tries and the 5th ends it`
      - 틀린 pin 4번은 403. 5번째 틀리면 403이고 그 뒤 맞는 pin도 410.
    - `finish works once per state` → 같은 요청 두 번이면 두 번째는 410.
    - `state expires after 10 minutes` → `created_at`을 11분 전으로 고친 뒤 finish하면 410. callback이면 400 HTML.
    - `kakao error redirects with error=cancelled` → `?error=access_denied&state=S`면 Location에 `error=cancelled`.
    - `nickname from kakao is trimmed to 20 code points or 드라이버` → 30자 이모지 닉네임과 빈 닉네임.
    - `start is limited to 30 per IP per hour` → 같은 IP 31번째 start가 429.
- [ ] **Step 2: 실패 확인** — `cd worker && npx vitest run test/kakao.test.ts` → 404 등으로 실패.
- [ ] **Step 3: 구현** — `kakao.ts` + index 라우트.
  - 마치기는 행을 `DELETE … WHERE state = ? AND pin_hash IS NOT NULL RETURNING *`로 먼저 차지해서 한 번만 쓰게 한다.
  - 틀렸으면 tries를 올린 행을 다시 넣는다(5 미만일 때).
  - 계정 변경과 열쇠 발급은 `env.DB.batch` 한 번으로 한다.
  - 시작할 때 10분 넘은 `oauth_states` 행을 지운다.
- [ ] **Step 4: 통과 확인** — kakao.test와 기존 테스트 모두 통과. `cd worker && npx tsc --noEmit` 깨끗.
- [ ] **Step 5: 커밋**

### Task 3: 합치기 + 파일 대체 + 기록 목록 + 기본 코스 열

**Files:**
- Modify:
  - `worker/src/kakao.ts`: `mergeUsers(env, from, into): D1PreparedStatement[]`
  - `worker/src/files.ts`
  - `worker/src/data.ts`: deleteSession, putSession 키 유지, putCourse/listCourses의 builtin, listSessions
  - `worker/src/index.ts`: `GET /api/sessions`
- Test: `worker/test/kakao.test.ts`, `worker/test/api.test.ts`(builtin·목록)

**Interfaces:**
- Produces:
  - `GET /api/sessions` → `[{id, courseId, courseVersion, startedAt, endedAt, device, rawKey, processedKey, formatVersion}]`
    - 내 것만, `started_at` 새것부터.
    - startedAt·endedAt는 ISO 문자열(서버 행 그대로).
  - `PUT /api/courses/{id}` 본문에 `builtin?: string|null`(40자 이하)을 받는다. `GET /api/courses` 각 행에 `builtin`.
  - 파일 GET/HEAD `/files/{me}/{sid}.{kind}.json.gz`
    - 그 키가 R2에 없으면 `sessions` 행(id = sid, owner = me)의 저장된 `{kind}_key`로 찾는다.
    - 저장된 키가 요청 키와 다를 때만 그 키를 준다.
  - `putSession`
    - 기존 행의 키가 다른 사용자 폴더(합쳐진 것)면 그 키를 유지한다.
    - 새 키 검사는 그대로(`${me}/${id}.{kind}.json.gz`).
  - `deleteSession`: 저장된 raw/processed 키와 `${me}/…` 키를 모두 지운다.

- [ ] **Step 1: 실패하는 테스트**
  - `anonymous B into known kakao A merges`
    - B가 코스 1·세션 1(파일 raw/processed 업로드, 랩 1)·친구 C를 갖고 로그인한다.
    - 결과:
      - kind `merged`, userId A.
      - A 열쇠로 `GET /api/sessions`에 그 세션이 있고 `GET /api/courses`에 그 코스가 있다.
      - `GET /files/A/{sid}.raw.json.gz`가 200이고 바이트가 같다. HEAD도 200.
      - C의 `GET /api/friends`에 A가 있고 B는 없다.
      - B 열쇠는 401.
  - `merged session delete removes stored files` → A가 그 세션을 지우면 R2에서 B 경로 파일이 없어진다.
  - `re-put merged session keeps stored keys` → A가 `raw_key: A/{sid}.raw…`로 PUT해도, 파일 GET이 여전히 200(B 경로에서).
  - `sessions list is mine only` → 남의 세션은 안 보인다.
  - `course builtin round-trip`(api.test) → `builtin:'baehu'`로 PUT하면 GET에 `builtin:'baehu'`. 41자면 400.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
  - 합치기 문장: 코스·세션·랩 owner를 바꾸고, 친구를 양방향으로 `INSERT OR IGNORE` 옮기고(자기 자신 제외), B의 friends·presence를 지우고, `users` B를 지운다. Task 2의 finish batch에 넣는다.
- [ ] **Step 4: 통과 확인** — worker 전체 테스트, tsc.
- [ ] **Step 5: 커밋**

### Task 4: CI가 카카오 비밀값을 Worker에 넣기

**Files:**
- Modify: `.github/workflows/ci.yml` (deploy-worker 작업의 `wrangler deploy` 단계)
- Test: `test/style/ciKakao.test.ts` (node: 워크플로 글을 읽어 확인)

- [ ] **Step 1: 실패하는 테스트**
  - 워크플로 글에 `KAKAO_REST_API_KEY: ${{ secrets.KAKAO_REST_API_KEY }}`와 `KAKAO_CLIENT_SECRET: ${{ secrets.KAKAO_CLIENT_SECRET }}`가 deploy 단계 env에 있다.
  - deploy 명령에 `--secrets-file`이 있다.
  - 값을 `echo`로 출력하는 줄이 없다.
- [ ] **Step 2: 실패 확인** — `npx vitest run test/style/ciKakao.test.ts`
- [ ] **Step 3: 구현**
  - 두 값이 모두 있으면 `node -e`로 `{"KAKAO_REST_API_KEY":…, "KAKAO_CLIENT_SECRET":…}`를 `$RUNNER_TEMP/kakao.json`(권한 600)에 쓴다.
  - `npx wrangler deploy --var … --secrets-file "$RUNNER_TEMP/kakao.json"`. 없으면 기존 명령 그대로.
  - 끝나면 파일을 지운다.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**

### Task 5: 앱 계정 — 카카오 시작·마치기·진행 중·로그아웃 API

**Files:**
- Create:
  - `src/app/kakaoLogin.ts`: 시작·마치기·진행 중 상태
  - `src/ui/screens/KakaoAuthScreen.tsx`: `#/auth/kakao`
- Modify:
  - `src/app/account.ts`: `kakao` 상태, `/api/me`의 kakao 반영, `adoptLogin()`, `markAccountLost` 가드
  - `src/ui/App.tsx`: `/auth/`는 첫 실행 전에도 보이게, 라우트
  - `src/main.tsx`: 시작 순서
- Test: `test/ui/kakaoLogin.test.ts`, `test/ui/kakaoAuthScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1~3 라우트.
- Produces (`src/app/kakaoLogin.ts`):
  - `getProviders(): Promise<{kakao: boolean}>`: 한 번 받아 기억, 실패면 `{kakao:false}`.
  - `startKakaoLogin(from: '#/settings' | '#/'): Promise<void>`
    - verifier(32바이트 base64url)를 만들고, `localStorage['gachitayo.kakaoLogin'] = {state, verifier, from, startedAt}`에 둔다.
    - `location.assign(url)`로 이동한다.
  - `pendingKakaoLogin(): {state; from; startedAt} | null`: 10분 지나면 지우고 null.
  - `cancelKakaoLogin(): void`
  - `finishKakaoLogin(state: string, pin: string): Promise<{ok: true; kind: string} | {ok: false; error: string}>`
    - 진행 중 표시가 그 state가 아니면 `{ok:false, error:'다른 창에서 시작한 로그인이에요'}`.
    - 성공하면 `adoptLogin({userId, token, nickname, kakao:true})` → 진행 중 표시 지우기 → `startRestore()`(Task 6).
  - `useKakaoPending()`: 진행 중 표시를 구독한다.
- Produces (`account.ts`):
  - `AccountState`에 `kakao: boolean`. 폰 키 `gachitayo.kakao`.
  - `adoptLogin(r: {userId; token; nickname; kakao: boolean}): void`: 열쇠·id·닉네임을 저장하고 onboarded=1, lost=false, status ready.
  - `logoutRemote(): Promise<void>`: `POST /auth/logout`.
  - 로그인 마치는 중(`finishing` 플래그)에는 `markAccountLost()`가 아무것도 하지 않는다.
- `KakaoAuthScreen`(해시 `#/auth/kakao?state=&pin=&error=`):
  - error=cancelled → "카카오 로그인을 취소했어요". failed → "카카오 로그인에 실패했어요". 둘 다 [돌아가기] = `from` 또는 `#/`.
  - 진행 중 state와 같으면 자동으로 finish → 성공하면 `from`으로 이동. 실패하면 오류 글과 [다시 시도].
  - 다르거나 없으면:
    - 큰 글씨로 pin을 보인다: "앱으로 돌아가서 이 번호를 입력해 주세요" + `482913`.
    - 그 아래: "다른 사람에게 알려 주지 마세요. 10분 동안만 쓸 수 있어요".

- [ ] **Step 1: 실패하는 테스트** (fetch는 vi 가짜, `location.assign`도 가짜)
  - `startKakaoLogin stores pending with verifier and sends only its hash`
    - start 요청 본문의 `verifierHash`가 저장된 verifier의 SHA-256 hex와 같다.
    - 본문에 verifier 원문은 없다.
  - `finishKakaoLogin adopts token and marks kakao`
    - 성공 응답 뒤 `getAuth()`가 새 열쇠, `getAccountState().kakao === true`, onboarded true, 진행 중 표시 없음.
  - `finish with a different state is refused without calling server`
  - `pending login expires and can be cancelled` → 시계를 10분 1초 뒤로 하면 null. cancel하면 null.
  - `401 while finishing does not mark account lost`
  - KakaoAuthScreen:
    - `shows pin when this window did not start the login`
    - `auto finishes when state matches`
    - `cancelled shows message`
  - App 라우팅: onboarded가 false여도 `#/auth/kakao`면 KakaoAuthScreen이 나온다.
- [ ] **Step 2: 실패 확인** — `npx vitest run test/ui/kakaoLogin.test.ts test/ui/kakaoAuthScreen.test.tsx`
- [ ] **Step 3: 구현.** `main.tsx`는 `initAccount()` 전에 해시가 `#/auth/kakao`이고 진행 중 state와 같으면 마치기를 먼저 기다린다(화면 자동 finish와 겹치지 않게 kakaoLogin 안에서 한 번만).
- [ ] **Step 4: 통과 확인** — 루트 `npx vitest run`, `npx tsc -b`.
- [ ] **Step 5: 커밋**

### Task 6: 되살리기 (`src/app/restore.ts`) + 기본 코스 이어 붙이기 + 폰에만 있는 기록 올리기

**Files:**
- Create: `src/app/restore.ts`
- Modify:
  - `src/app/drive.ts`: `processRestoredSession`
  - `src/sync/syncEngine.ts`: `courseRow`에 `builtin`
  - `src/server/remote.ts` 또는 restore 안의 fetch: 목록·파일 받기
  - `src/main.tsx`: 카카오 계정이면 시작 때 `startRestore()`
- Test: `test/ui/restore.test.ts` (fake-indexeddb + 가짜 fetch), `test/sync/…`(courseRow builtin. 기존 syncEngine 테스트 파일에 추가)

**Interfaces:**
- Consumes:
  - `GET /api/courses`, `GET /api/sessions`, `GET /files/{me}/{id}.raw.json.gz`
  - `readRawFile`, `gunzipJson`, `getRepo()`, `getDriveRepo()`, `refreshSessions()`, `getRecordingState()`, `enqueueSessionUpload`
- Produces:
  - `export type RestoreState = { running: boolean; done: number; total: number; failed: number }`
  - `useRestore(): RestoreState`, `getRestoreState()`
  - `startRestore(): Promise<void>`: 이미 도는 중이면 그 약속을 돌려준다. 녹화 중(phase ≠ 'idle')이면 끝난 뒤로 미룬다(녹화 상태 구독).
  - `localOnlySessions(): Promise<SessionRecord[]>`: 서버 목록에 없는 폰 기록(녹화 중 제외). 통신 실패면 throw.
  - `drive.ts`의 `processRestoredSession(sessionId: string): Promise<DriveResultRecord | null>`: `processStoredSession(deps(), id)`를 하고 업로드 대기열에 넣지 않는다.
  - `courseRow(c)`가 `builtin: c.builtin ?? null`을 넣는다.
- 규칙 (설계 5.7·5.7-1·5.7-2):
  1. 서버 코스 → 기본 코스 판별
     - `builtin`이 있거나, 이름이 기본 코스 이름과 같고 출발선이 30 m 안이면 기본 코스다.
     - 기본 코스면 `serverId → 폰의 같은 기본 코스 id` 표에 넣고 폰에 새로 넣지 않는다.
     - 아니면 폰에 없거나 버전이 낮을 때 `putCourse`.
  2. 서버 기록 중 폰에 없는 id를 새것부터 처리
     - rawKey가 없으면 건너뛴다.
     - 원본을 받아 `repo.create({id, courseId: 표로 바꾼 id, courseVersion: 바꿨으면 폰 코스 version, status:'finished', startedAt, endedAt, device, calibration:null, summary:null})`
     - `putChunk(seq 0)` → `processRestoredSession`
     - `repo.update(id, {status:'uploaded', uploadedAt: Date.now()})`
     - 실패하면 failed+1 하고 그 기록을 지운다(`driveRepo.deleteSession`). 다음 실행에 다시 한다.
  3. 폰에만 있는 기록
     - imported가 아니고 원본 조각이 있으면 `uploadedAt: null, status:'processed'`로 바꾸고 `enqueueSessionUpload`.
- [ ] **Step 1: 실패하는 테스트**
  - `restores missing sessions with same id and does not re-upload`
    - 서버에 기록 2개(하나는 폰에 이미 있음) → 1개만 받는다.
    - 같은 id, status 'uploaded', 결과(laps)가 있고, 업로드 대기열 0.
  - `builtin server course maps to local builtin`
    - 서버 코스 `builtin:'baehu'`(id S)를 쓴 기록 → 폰 기록의 courseId가 폰 배후령 id다.
    - 폰 코스 목록에 배후령이 하나뿐이다.
  - `legacy builtin without key matches by name and start gate`
  - `user course newer on server replaces local`
  - `skips sessions without raw key`
  - `restore resumes without duplicates after a failure`
    - 두 번째 파일 GET이 500 → failed 1, 그 기록은 폰에 없다.
    - 다시 실행하면 그것만 받아 총 개수가 맞다.
  - `local-only sessions with raw are queued for upload, imported ones are not`
  - `does not run while recording, runs after`
  - `courseRow includes builtin`
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 루트 전체 테스트, tsc
- [ ] **Step 5: 커밋**

### Task 7: 화면 — 첫 화면 카카오 버튼, 설정 계정 칸, 번호 입력, 되살리는 중, 로그아웃

**Files:**
- Create: `src/ui/components/KakaoButton.tsx`, `src/ui/components/KakaoPendingCard.tsx`, `src/ui/components/RestoreBanner.tsx`
- Modify:
  - `src/ui/screens/WelcomeScreen.tsx`, `src/ui/screens/SettingsScreen.tsx`(AccountSection), `src/ui/screens/HistoryScreen.tsx`(맨 위 RestoreBanner)
  - `src/app/account.ts`: `logout()`
  - `src/storage/db.ts`: `clearAll()`
  - `src/ui/styles.css`
- Test: `test/ui/welcomeKakao.test.tsx`, `test/ui/settingsAccount.test.tsx`, `test/style/kakaoButton.test.ts`

**Interfaces:**
- Consumes: Task 5 `getProviders/startKakaoLogin/useKakaoPending/finishKakaoLogin/cancelKakaoLogin`, Task 6 `useRestore/localOnlySessions`, `useSync().pending`, `useRecording().phase`.
- Produces:
  - `logout(): Promise<{ok: true} | {ok: false; error: string}>` (account.ts)
    - 막는 경우:
      - 녹화 중 / 되살리는 중 → "주행이나 되살리기가 끝난 뒤에 로그아웃할 수 있어요"
      - 업로드 대기 > 0 → "아직 올리지 못한 기록이 있어요. 올린 뒤에 다시 해 주세요"
      - 통신 실패 → "통신이 연결돼야 로그아웃할 수 있어요"
    - 통과하면 서버 logout → `db.clearAll()`(sessions·chunks·results·courses·refLaps·queue) → 계정 폰 키(토큰·id·닉네임·onboarded·kakao) 지우기 → `location.replace('#/')` 후 새로고침.
    - 설정(settings)은 남긴다.
  - 화면 글 (정해진 글)
    - 첫 화면
      - 카카오 버튼 "카카오로 시작하기". 그 아래 sub "폰을 바꿔도 카카오로 로그인하면 기록이 돌아와요".
      - 기존 버튼 글은 "로그인 없이 시작".
      - 두 버튼 모두 안전 안내 체크가 있어야 눌린다.
      - 카카오 버튼은 닉네임 칸이 비어도 눌린다(닉네임은 카카오에서).
      - providers.kakao가 false면 카카오 버튼을 숨긴다.
    - 설정 계정 칸
      - 연결 안 됨: "카카오로 로그인" 버튼 + "로그인하면 폰을 바꿔도 기록이 돌아와요".
      - 연결됨: "카카오 연결됨" 표시 + [로그아웃].
      - 끊김(lost): 기존 "새 계정 만들기" 위에 "카카오로 로그인"(예전에 카카오 연결했다면 이걸로 돌아와요).
      - 익명 안내 sub는 kakao면 "카카오 계정에 연결돼 있어요. 폰을 바꿔도 카카오로 로그인하면 기록이 돌아와요."로 바꾼다.
    - 로그아웃 확인 창: "로그아웃하면 이 폰의 기록과 내 코스가 지워져요. 다시 로그인하면 서버에서 되살아나요." + (n>0이면) "이 폰에만 있는 기록 n개는 되살릴 수 없어요." [로그아웃] [취소]
    - 진행 중 카드(첫 화면·설정, 진행 중일 때): "카카오 로그인을 마치는 중이에요. 다른 창에 6자리 번호가 보이면 입력해 주세요." 숫자 입력(inputMode numeric, 6자리) [확인] [취소]
    - 되살리는 중: "기록 되살리는 중 12/40". 실패가 있으면 " · 실패 2 (다음에 다시)".
- [ ] **Step 1: 실패하는 테스트**
  - `welcome shows kakao button only when provider is on and needs safety check`
  - `welcome kakao works with empty nickname`
  - `settings shows login when not linked and logout when linked`
  - `lost account offers kakao login`
  - `logout is blocked while recording or restoring` / `blocked with pending uploads`
  - `logout confirm shows local-only count and clears data`
    - clearAll이 불리고, 계정 키가 지워지고, settings 키는 남는다.
  - `pending card submits 6 digit pin`
  - `restore banner shows progress`
  - CSS: `.kakao-btn`의 background가 `#FEE500`이고, 글자색이 `rgba(0, 0, 0, 0.85)`.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 전체 테스트, tsc
- [ ] **Step 5: 커밋**

### Task 8: 시안·사양서·배포

- [ ] **Step 1: 시안 스크린샷.** 가짜 API(`$S/vmap/fake-api.mjs`)에 providers·start를 흉내 내는 경로를 더한다. 찍을 화면:
  - 첫 화면(카카오 버튼)
  - 설정(연결 안 됨 / 연결됨)
  - 진행 중 번호 입력 카드
  - `#/auth/kakao?state=x&pin=482913`(다른 창 번호 화면)
  - 되살리는 중 배너
- [ ] **Step 2:** 사용자에게 보내고 승인을 기다린다.
- [ ] **Step 3: 사양서 변경 이력.** `docs/specs/2026-11-12-gachitayo-phase1-spec.md`에 줄을 더하고 8.1·8.8·6.5 요약을 고친다.
- [ ] **Step 4:** 승인되면 main에 합치고 푸시 → CI(테스트·Worker 배포·Pages) 성공을 확인한다.
- [ ] **Step 5: 실제 로그인 확인 안내.** 사용자에게 폰(브라우저와 홈 화면 앱)에서 카카오 로그인을 해 보게 하고 결과를 듣는다. 홈 화면 앱이 번호 화면으로 가는지 본다.
