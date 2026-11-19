// 정식 빌드 스위치 (설계 docs/superpowers/specs/2026-11-18-official-build-design.md, 세영 "정식버전엔 위치공유를 빼고 추후에 사업자등록/신고 후 재활성화"):
// 위치기반서비스사업 신고 전에는 다른 사람과 위치를 주고받지 않는다. 같은 코드에서 빌드 때 값으로 나눈다(따로 저장소·복사본 없음).
//   VITE_LOCATION_SHARING=off → 지도 위치 공유(친구·팀원 점, 위치 공유 단추) 끔
//   VITE_LIVE_GAP=off        → 앞 친구·앞 차 간격 끔 (안 적으면 위와 같은 값. 세영 결정 3: 정식은 둘 다 끔, 센터 답에 따라 간격만 따로 켤 수 있게 나눔)
// 서버에서 원격으로 켜지 않는다 (심사 뒤 숨긴 기능을 켜면 애플 2.3.1 위반). 다시 켤 때는 값을 바꿔 빌드해 업데이트 심사.
// 화면만 숨기지 않고 보내기·받기를 막는 곳도 이 함수만 본다 (friends·liveLink·group·drive)

// 안 적으면 기본값, 'on' 이면 켬, 그 밖의 값(off·OFF·false·오타)은 모두 끔 — 오타로 정식 빌드가 위치를 공유하지 않게 (검토 지적)
const flag = (v: string | undefined): boolean | null => (v === undefined ? null : v === 'on');

/** 지도에서 서로 위치 보기 (위치 공유 켜기·친구 위치·팀원 차 점) */
export function locationSharing(): boolean {
  return flag(import.meta.env.VITE_LOCATION_SHARING) ?? true;
}

/** 앞 친구·앞 차와의 간격(초). 상대 위치가 서버를 거쳐 오므로 위치 공유와 같은 기준 */
export function liveGap(): boolean {
  return flag(import.meta.env.VITE_LIVE_GAP) ?? locationSharing();
}

/** 다른 사람과 위치를 주고받는 게 하나라도 켜져 있나 (팀 방에서 내 위치를 보낼지) */
export const shareAnyLocation = (): boolean => locationSharing() || liveGap();

/** 설정 맨 아래 표시: 정식 빌드인지 */
export const buildChannel = (): '정식' | '테스트' => (locationSharing() ? '테스트' : '정식');

/** 바이크 기울기를 센서 기울기 + 계산 기울기로 (leanFusion.ts). 2026-11-19 웹에서 먼저 시험(세영 "웹에서 테스트하게 앱은 건들지말고")한 뒤
 *  세영 "이대로 정식버전(위치공유 x)도 배포해" → 웹·아이폰 앱 모두 켠다. 빌드 값 VITE_LEAN_FUSED=off 면 예전 계산(lean.ts)만 */
export const leanFused = (): boolean => flag(import.meta.env.VITE_LEAN_FUSED) ?? true;
