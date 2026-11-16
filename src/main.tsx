import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initRecording } from './app/recording';
import { getAccountState, initAccount } from './app/account';
import { finishFromHash, setAfterKakaoLogin } from './app/kakaoLogin';
import { startRestore } from './app/restore';
import { initSync } from './app/sync';
import { initFriends } from './app/friends';
import { seedBuiltinCourses } from './app/courses';
import { syncCoursePrefs } from './app/coursePrefs';
import { startDrivingSignal } from './app/drivingSignal';
import { resumeGroupRoom } from './app/group';
import { startAppLinks } from './app/appLinks';
import { subscribeAccount } from './app/account';
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
// 계정 확인 뒤 업로드 대기열을 돌린다 (서버 설정 전이면 폰에만 저장).
// 카카오에서 이 창으로 돌아왔으면 계정 확인보다 먼저 로그인을 마친다 (예전 열쇠로 "계정 끊김"이 뜨지 않게)
// 카카오 계정이면 서버에 있고 이 폰에 없는 기록·코스를 되살린다 (로그인 직후와 앱을 열 때마다)
setAfterKakaoLogin(() => void startRestore());
void finishFromHash(window.location.hash)
  .then(initAccount)
  .then(initSync)
  .then(() => {
    if (getAccountState().kakao) void startRestore();
    // 들어가 있던 그룹 주행 방으로 다시 (24시간이 지났거나 나갔으면 잊는다)
    void resumeGroupRoom();
    // 즐겨찾기·분류를 계정과 맞춘다 (카카오 로그인으로 계정이 바뀌어도 다시)
    void syncCoursePrefs();
    let lastUser = getAccountState().userId;
    subscribeAccount(() => {
      const u = getAccountState().userId;
      if (u !== lastUser) {
        const changed = lastUser !== null && u !== null;
        lastUser = u;
        void syncCoursePrefs({ accountChanged: changed });
      }
    });
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
