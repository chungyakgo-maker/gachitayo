import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initRecording } from './app/recording';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/pwa/registration';
import './ui/fonts';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다');

registerServiceWorker();
// 이전 실행에서 끝나지 않은 기록을 찾는다 (사양서 9장 앱 중단)
void initRecording();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
