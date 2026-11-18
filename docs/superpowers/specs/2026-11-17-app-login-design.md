# 아이폰 앱 로그인: 카카오 + 애플 설계

2026-11-17 · 사용자 결정 "카카오로그인, 애플로그인 다 넣어야된다" (앱). 웹은 지금처럼 카카오 로그인만.

## 사용자 결정

- 앱에 카카오 로그인과 애플 로그인을 모두 넣는다 ("로그인 없이 시작"은 그대로).
- 웹은 카카오 로그인만 (애플 로그인은 앱에만).
- 만드는 것은 아이폰 갈래(ios)와 시험에서. 서버에 올릴 때·앱을 올릴 때는 사용자에게 먼저 묻는다.

## 카카오 로그인 (앱)

웹은 지금처럼 페이지가 카카오로 갔다가 웹 주소로 돌아온다. 앱은 앱 안에서 로그인 창을 띄우고 앱으로 돌아온다.

- 앱이 `POST /auth/kakao/start {returnTo: 'dgo://auth/kakao', verifierHash}`로 시작 (웹과 같은 verifier·번호 방식).
- 서버는 returnTo로 웹앱 출처 또는 정확히 `dgo://auth/kakao`만 받는다 (열린 리다이렉트 금지 그대로).
- 카카오 콜백이 끝나면 서버는 `dgo://auth/kakao?state=…&pin=…`(또는 `&error=cancelled|failed`)로 보낸다.
- 앱은 iOS 로그인 창(ASWebAuthenticationSession, 주소 체계 `dgo`)으로 열고, 돌아온 주소를 받아 `#/auth/kakao?state&pin`으로 넘겨 지금 마치기 화면이 그대로 마친다.
- 창을 닫으면 진행 중 로그인을 지운다.

## 애플 로그인 (앱만)

- 앱: 아이폰 기본 애플 로그인 창(AuthenticationServices). 시작 때 임의 값(nonce)을 만들어 해시만 애플에 주고, 받은 identityToken·authorizationCode와 원래 nonce를 서버로.
- `POST /auth/apple {identityToken, authorizationCode, nonce, nickname?}` (+ 지금 폰 열쇠가 있으면 그 계정에서 시작한 로그인)
  - identityToken 확인: 애플 공개 키(https://appleid.apple.com/auth/keys, 1시간 기억)로 RS256 서명, iss `https://appleid.apple.com`, aud = 번들 ID `kr.dgo.app`, 만료, nonce = sha256(보낸 nonce).
  - 계정 규칙은 카카오와 같다 (카카오 설계 5.3): 처음 보는 애플 계정 + 지금 익명 계정 → 그 계정에 연결(linked), 지금 계정이 없거나 이미 다른 로그인 → 새 계정(created), 아는 애플 계정 → 로그인(login), 지금 익명 계정이면 합치기(merged), 다른 로그인 계정이면 바꾸기(switched). `identities.provider = 'apple'`, subject = 애플 사용자 번호(sub).
  - 닉네임: 새 계정이면 애플이 준 이름(처음 로그인 때만 옴) 또는 "드라이버".
  - 애플 비밀값(APPLE_SIGNIN_KEY_P8, APPLE_SIGNIN_KEY_ID, APPLE_TEAM_ID)이 있으면 authorizationCode를 애플에 바꿔 refresh token을 D1 `apple_tokens`에 둔다 (계정 삭제 때 애플 연결을 끊으려고, 애플 규칙). 없으면 로그인은 되고 끊기만 못 한다.
- 계정 삭제(`DELETE /api/me`): apple_tokens가 있으면 애플 revoke를 부른 뒤 지운다(실패해도 계정은 지운다).
- `/auth/providers` → `{kakao, apple: true}`, `/api/me` → `apple` 연결 여부.

## 앱 화면

- 첫 화면: "카카오로 시작하기" 아래 "Apple로 계속하기"(애플 버튼 모양: 검정 바탕 흰 글자·로고). 둘 다 동의 체크 뒤.
- 설정 계정 칸: 카카오 로그인 / Apple로 로그인, 연결 상태(카카오 연결됨 · Apple 연결됨).
- 로그인한 계정(카카오 또는 애플)이면 다른 폰에서 기록 되살리기(지금 카카오와 같게).

## 아이폰 쪽 (네이티브)

- 앱 안 작은 플러그인 `DgoAuth` (Swift, 바깥 패키지 없이): `webAuth({url, scheme})`, `appleSignIn({nonce})`.
- 앱 화면 컨트롤러 `MainViewController`가 플러그인을 등록, SceneDelegate가 그것을 쓴다.
- 권한 파일 `App.entitlements`에 Sign in with Apple. 애플 개발자 사이트의 App ID에 Sign In with Apple을 켜야 한다(사용자).

## 하지 않을 것

웹 애플 로그인, 카카오톡 앱으로 로그인(네이티브 SDK), 계정 삭제 때 카카오 연결 끊기(카카오 어드민 키 필요).
