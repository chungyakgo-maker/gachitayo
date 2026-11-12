import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 화면에 표시할 버전: GitHub Actions에서는 커밋 앞 7자리, 이 밖에서는 'local'
const appVersion = process.env.GITHUB_SHA?.slice(0, 7) ?? 'local';

export default defineConfig({
  // GitHub Pages 하위 경로: https://chungyakgo-maker.github.io/gachitayo/
  base: '/gachitayo/',
  plugins: [
    react(),
    VitePWA({
      // 새 버전은 사용자가 '업데이트'를 눌러야 적용 (주행 중 자동 새로고침 방지)
      registerType: 'prompt',
      // 등록은 usePwaUpdate 훅에서 한다
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: '같이타요',
        short_name: '같이타요',
        description: '와인딩·서킷 주행 기록기',
        lang: 'ko',
        start_url: './',
        scope: './',
        display: 'standalone',
        // 주행 화면은 가로·세로 모두 지원 (사양서 8.4)
        orientation: 'any',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 통신 없이도 앱 화면이 열리도록 빌드 결과 전체를 캐시 (사양서 4장)
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
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
