import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initRecording } from './app/recording';
import { initAccount } from './app/account';
import { finishFromHash } from './app/kakaoLogin';
import { initSync } from './app/sync';
import { initFriends } from './app/friends';
import { seedBuiltinCourses } from './app/courses';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/pwa/registration';
import { installAppHeight } from './ui/viewport';
import './ui/fonts';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다');

registerServiceWorker();
// 아이폰 홈 화면 앱에서 아래 탭이 화면 맨 아래에 붙도록 앱 높이를 화면 크기로 맞춘다
installAppHeight();
// 이전 실행에서 끝나지 않은 기록을 찾는다 (사양서 9장 앱 중단)
void initRecording();
// 계정 확인 뒤 업로드 대기열을 돌린다 (서버 설정 전이면 폰에만 저장).
// 카카오에서 이 창으로 돌아왔으면 계정 확인보다 먼저 로그인을 마친다 (예전 열쇠로 "계정 끊김"이 뜨지 않게)
void finishFromHash(window.location.hash)
  .then(initAccount)
  .then(initSync);
// 기본 코스(배후령 · 미시령 옛길 · 만항재)를 처음 한 번 코스 목록에 넣는다
void seedBuiltinCourses();
// 친구 위치 공유: 주행 기록의 GPS도 내 위치로 쓴다 (공유는 앱을 열 때마다 꺼져 있다)
initFriends();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
