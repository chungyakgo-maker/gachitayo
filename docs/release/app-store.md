# 디고 앱스토어 등록 자료 (초안)

2026-11-16 · 출시 준비 (2026-11-17 갱신: 이름·번들 ID·연락처·로그인·영어 심사 메모. **2026-11-18 정식 빌드(위치 공유 끔) 기준으로 고침**: 팀 주행·프로필 사진, 위치 공유 문장 뺌).
**심사에 내는 빌드는 Codemagic "디고 아이폰 정식 (위치 공유 끔) → App Store" 빌드(1.0.0)만.** App Store Connect 배포 화면 버전 번호도 1.0.0. App Store Connect → 디고 → 앱 정보 / 1.0 버전 화면에 그대로 붙여 넣는다.
법적 문구(약관·개인정보)는 초안이며 확인은 사용자가 한다.

## 기본 정보

| 칸 | 넣을 값 |
|---|---|
| 이름 | 디고: 드라이브 코스 추천 (홈 화면 이름은 "디고") |
| 번들 ID | kr.dgo.app |
| 부제 (30자) | 와인딩 랩타이머 · 팀 주행 |
| 카테고리 | 주: 내비게이션 · 부: 스포츠 |
| 개인정보처리방침 URL | https://chungyakgo-maker.github.io/gachitayo/privacy.html |
| 지원 URL | https://chungyakgo-maker.github.io/gachitayo/privacy.html (문의 이메일 chungyakgo@gmail.com 이 들어 있는 페이지) |
| 저작권 | 2026 (사용자 이름 또는 상호) |
| 가격 | 무료 |

## 키워드 (100자, 쉼표로)

```
랩타이머,랩타임,와인딩,드라이브,주행기록,코스,페이스노트,팀주행,G미터,델타,서킷,트랙,투어링
```

## 설명

```
디고는 와인딩·드라이브 코스를 달리며 랩타임과 구간 기록을 재는 앱이에요.

■ 코스 랩타이머
· 출발선을 지나면 자동으로 랩을 재고, 베스트 랩과 비교한 델타를 실시간으로 보여줘요
· 구간(섹터) 기록, G미터, 속도를 한 화면에
· 화면을 꺼도 기록이 이어져요

■ 커브 표지판
· 코스와 목적지 경로에 다가오는 커브를 표지판으로 미리 알려줘요
· 커브 방향을 화면 가장자리 색으로도 보여줘요

■ 목적지로 주행
· 장소를 검색하거나 지도에서 찍으면 그 길로 커브 표지판을 띄워요

■ 팀 주행
· 친구로 팀을 만들어 두고(최대 15명), 팀으로 바로 함께 달려요
· 주행 순서와 권장 차 간격을 정하고, 방장이 정한 목적지를 모두가 함께 받아요
· 카카오톡으로 "주행 열었어요"를 알려 팀원을 불러요
· 친구·팀원에게만 보이는 작은 프로필 사진

■ 코스 둘러보기
· 기본 코스, 해안 길·산 길, 즐겨찾기, 인기 도로(실시간·7일·30일·계절별)

■ 기록과 분석
· 지난 주행을 다시 재생하고, 랩·구간·G값을 분석해요
· GPX·CSV로 내보내기

로그인 없이 닉네임만 정하면 바로 시작할 수 있어요.
※ 주행 중에는 도로 교통 법규를 지키고, 화면 조작은 정차 중에만 하세요.
```

## 이번 버전의 새로운 기능

```
첫 출시
```

## 연령 등급

모든 질문 "없음" → 4+ (폭력·성인 내용·도박·제한 없는 웹 접근 없음)

## 앱 개인정보 (App Privacy) 답변 제안

데이터를 수집함 → 예. 추적(다른 회사 앱·웹과 연결해 광고 등) → 아니요. 모든 항목 "사용자에게 연결됨: 예(익명 계정 번호와 묶임)", "추적: 아니요", 목적 "앱 기능".

| 종류 | 항목 | 왜 |
|---|---|---|
| 위치 | 정확한 위치 | 주행 기록·랩타임(내 계정에만 백업), 목적지 길찾기. 다른 이용자와 공유하지 않음 |
| 식별자 | 사용자 ID | 익명 계정 번호, 카카오 회원번호·애플 사용자 번호(그 로그인을 고른 경우) |
| 사용자 콘텐츠 | 사진 또는 동영상 | 프로필 사진(고른 경우만, 160×160으로 줄여 저장, 친구·같은 팀만 봄) |
| 사용자 콘텐츠 | 기타 사용자 콘텐츠 | 닉네임, 직접 만든 코스, 즐겨찾기, 팀 이름 |
| 검색 기록 | 검색 기록 | 장소 검색어 (서버는 저장하지 않고 네이버로 바로 보냄, 하루 횟수만 셈) — 보수적으로 표시 |
| 기타 데이터 | 기타 데이터 유형 | 모션 센서 값(G값), 기기 종류 |

수집하지 않음: 연락처, 건강, 금융, 광고 데이터, 진단(충돌) 데이터.

## 심사 메모 (App Review Information → 메모, 영어)

메리고처럼 영어로. 데모 계정 대신 "로그인 없이 시작" 또는 "Apple로 로그인" 안내.

```
Thank you for reviewing DGO, a lap timer and drive-course app for Korean winding roads.

Sign-in: No demo account is needed.
- On the first screen, type any nickname, tick the safety/terms checkbox and tap "로그인 없이 시작" (Start without login), or
- Tap "로그인" (Log in) and choose "Apple로 로그인" (Sign in with Apple). Kakao login is also offered.

Background location: Used only after the user taps "주행 시작" (Start driving) and starts recording a drive, so lap timing continues while the screen is off or another app is in front (the phone is mounted in the car). Recording stops as soon as the drive ends. The location on the main map is used only while the app is on screen.

Motion sensors: Used during a drive to show and record acceleration/braking/cornering G-forces.

Team drive: Settings (설정) → "팀" → "+ 팀 만들기" creates a team (teams are made from friends; a team with only yourself is fine for review). Then Main → "주행 시작" (Start driving) → "팀 주행" (Team drive) opens the team lobby: driving order, a recommended gap shown as guidance, and a destination set by the host. In this version users do NOT share their locations with each other: there is no friend location on the map, no live gap to the car ahead, and the host shares only the destination (each member's route is calculated from their own position).

Profile photo: Settings (설정) → "사진 바꾸기" (Change photo) uses the photo picker or camera; the photo is reduced to 160×160 and shown only to friends and team members.

Account deletion: Settings (설정) → "계정과 모든 기록 지우기" deletes all data on the phone and the server. If the account used Sign in with Apple, the Apple token is revoked.

Contact: chungyakgo@gmail.com
```

## 스크린샷

6.9인치(1320×2868) 세로. **정식 빌드 화면으로** 만든다(친구 위치·앞 차 간격이 없는 화면): 메인 지도, 주행 화면(델타·커브 표지판), 팀 대기실, 팀 만들기, 목적지 검색, 분석.
