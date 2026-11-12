import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initRecording } from './app/recording';
import { initAccount } from './app/account';
import { initSync } from './app/sync';
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
// 계정 확인 뒤 업로드 대기열을 돌린다 (서버 설정 전이면 폰에만 저장)
void initAccount().then(initSync);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
