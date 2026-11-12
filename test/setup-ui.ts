import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom에는 캔버스가 없다: 그리기는 건너뛴다 (그리기 함수는 기록용 가짜 캔버스로 따로 시험한다)
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

afterEach(() => {
  cleanup();
});
