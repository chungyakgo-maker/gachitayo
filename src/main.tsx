import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/pwa/registration';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다');

registerServiceWorker();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
