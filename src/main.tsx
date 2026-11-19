import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initRecording } from './app/recording';
import { initAccount } from './app/account';
import { finishFromHash, setAfterKakaoLogin } from './app/kakaoLogin';
import { setAfterAppleLogin } from './app/appleLogin';
import { startMigrateLocal } from './app/migrateLocal';
import { initRecords } from './app/records';
import { initFriends } from './app/friends';
import { seedBuiltinCourses } from './app/courses';
import { startDrivingSignal } from './app/drivingSignal';
import { resumeGroupRoom } from './app/group';
import { startAppLinks } from './app/appLinks';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/pwa/registration';
import { installAppHeight, lockPageZoom } from './ui/viewport';
import './ui/fonts';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다');

registerServiceWorker();
// 아이폰 홈 화면 앱에서 아래 탭이 화면 맨 아래에 붙도록 앱 높이를 화면 크기로 맞춘다
installAppHeight();
// 웹페이지 전체 확대·축소 막기 (사용자 요청): 지도만 확대·축소된다
lockPageZoom();
// 이전 실행에서 끝나지 않은 기록을 찾는다 (사양서 9장 앱 중단)
void initRecording();
// 계정 확인 뒤 예전 앱이 남긴 서버 지우기를 보낸다 (기록은 폰에만, 올리기는 없다).
// 카카오에서 이 창으로 돌아왔으면 계정 확인보다 먼저 로그인을 마친다 (예전 열쇠로 "계정 끊김"이 뜨지 않게)
// 기록은 폰에만: 예전 앱이 서버에 올려 둔 기록을 계정마다 한 번 이 폰으로 옮긴다 (앱을 열 때·로그인 직후)
setAfterKakaoLogin(() => void startMigrateLocal());
setAfterAppleLogin(() => void startMigrateLocal());
void finishFromHash(window.location.hash)
  .then(initAccount)
  .then(initRecords)
  .then(() => {
    void startMigrateLocal();
    // 들어가 있던 그룹 주행 방으로 다시 (24시간이 지났거나 나갔으면 잊는다)
    void resumeGroupRoom();
  });
// 아이폰 앱: 방 초대 링크로 열리면 그 방으로
startAppLinks();
// 기본 코스로 주행 중이면 실시간 인기 신호 (코스 둘러보기 설계, 위치 없음)
startDrivingSignal();
// 기본 코스(배후령 · 미시령 옛길 · 만항재)를 처음 한 번 코스 목록에 넣는다
void seedBuiltinCourses();
// 친구 위치 공유: 주행 기록의 GPS도 내 위치로 쓴다 (공유는 앱을 열 때마다 꺼져 있다)
initFriends();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
