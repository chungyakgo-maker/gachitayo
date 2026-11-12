import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 화면에 표시할 버전: GitHub Actions에서는 커밋 앞 7자리, 이 밖에서는 'local'
const appVersion = process.env.GITHUB_SHA?.slice(0, 7) ?? 'local';

export default defineConfig({
  // GitHub Pages 하위 경로: https://chungyakgo-maker.github.io/gachitayo/
  base: '/gachitayo/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'ui',
          include: ['test/ui/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['test/setup-ui.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'core',
          include: ['test/**/*.test.ts'],
          exclude: ['test/ui/**'],
          environment: 'node',
        },
      },
    ],
  },
});
