# 디고 앱스토어 등록 자료 (초안)

2026-11-16 · 출시 준비 (2026-11-17 갱신: 이름·번들 ID·연락처·로그인·영어 심사 메모). App Store Connect → 디고 → 앱 정보 / 1.0 버전 화면에 그대로 붙여 넣는다.
법적 문구(약관·개인정보)는 초안이며 확인은 사용자가 한다.

## 기본 정보

| 칸 | 넣을 값 |
|---|---|
| 이름 | 디고: 드라이브 코스 추천 (홈 화면 이름은 "디고") |
| 번들 ID | kr.dgo.app |
| 부제 (30자) | 와인딩 랩타이머 · 그룹 주행 |
| 카테고리 | 주: 내비게이션 · 부: 스포츠 |
| 개인정보처리방침 URL | https://chungyakgo-maker.github.io/gachitayo/privacy.html |
| 지원 URL | https://chungyakgo-maker.github.io/gachitayo/privacy.html (문의 이메일 chungyakgo@gmail.com 이 들어 있는 페이지) |
| 저작권 | 2026 (사용자 이름 또는 상호) |
| 가격 | 무료 |

## 키워드 (100자, 쉼표로)

```
랩타이머,랩타임,와인딩,드라이브,주행기록,코스,페이스노트,그룹주행,G미터,델타,서킷,트랙,투어링
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

■ 그룹 주행
· 방을 만들어 친구를 초대하고, 주행 순서와 차 간격을 정해요
· 모두의 위치가 색깔 번호로 지도에 보이고, 앞 차와의 간격(초)을 알려줘요
· 방장이 정한 목적지 경로를 모두가 함께 받아요

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
| 위치 | 정확한 위치 | 주행 기록·랩타임, 친구·그룹 위치 공유(켰을 때만) |
| 식별자 | 사용자 ID | 익명 계정 번호, 카카오 회원번호·애플 사용자 번호(그 로그인을 고른 경우) |
| 사용자 콘텐츠 | 기타 사용자 콘텐츠 | 닉네임, 직접 만든 코스, 즐겨찾기 |
| 검색 기록 | 검색 기록 | 장소 검색어 (서버는 저장하지 않고 네이버로 바로 보냄, 하루 횟수만 셈) — 보수적으로 표시 |
| 기타 데이터 | 기타 데이터 유형 | 모션 센서 값(G값), 기기 종류 |

수집하지 않음: 연락처, 건강, 금융, 사진, 광고 데이터, 진단(충돌) 데이터.

## 심사 메모 (App Review Information → 메모, 영어)

메리고처럼 영어로. 데모 계정 대신 "로그인 없이 시작" 또는 "Apple로 로그인" 안내.

```
Thank you for reviewing DGO, a lap timer and drive-course app for Korean winding roads.

Sign-in: No demo account is needed.
- On the first screen, type any nickname, tick the safety/terms checkbox and tap "로그인 없이 시작" (Start without login), or
- Tap "로그인" (Log in) and choose "Apple로 로그인" (Sign in with Apple). Kakao login is also offered.

Background location: Used only after the user taps "주행 시작" (Start driving) and starts recording a drive, so lap timing continues while the screen is off or another app is in front (the phone is mounted in the car). Recording stops as soon as the drive ends. The location on the main map is used only while the app is on screen.

Motion sensors: Used during a drive to show and record acceleration/braking/cornering G-forces.

Group drive: Main → "주행 시작" → "그룹 주행" → "방 만들기" (Create room) shows the room lobby even alone.

Account deletion: Settings (설정) → "계정과 모든 기록 지우기" deletes all data on the phone and the server. If the account used Sign in with Apple, the Apple token is revoked.

Contact: chungyakgo@gmail.com
```

## 스크린샷

6.9인치(1320×2868) 세로. 시뮬레이터·웹 화면으로 만든다: 메인 지도, 주행 화면(델타·커브 표지판), 그룹 주행 대기실, 그룹 주행 지도, 목적지 검색, 분석.
