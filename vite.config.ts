import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 화면에 표시할 버전: GitHub Actions에서는 커밋 앞 7자리, 이 밖에서는 'local'
const appVersion = process.env.GITHUB_SHA?.slice(0, 7) ?? 'local';

export default defineConfig(({ mode }) => ({
  // GitHub Pages 하위 경로: https://chungyakgo-maker.github.io/gachitayo/
  // 아이폰 앱(--mode app, 사양서 13.3)은 앱 안 파일이라 상대 경로
  base: mode === 'app' ? './' : '/gachitayo/',
  plugins: [
    react(),
    VitePWA({
      // 아이폰 앱에는 서비스워커가 없다 (새 버전은 앱 업데이트로)
      disable: mode === 'app',
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
        // 통신 없이도 앱 화면이 열리도록 빌드 결과 전체를 캐시 (사양서 4장). 글꼴도 미리 보관한다 (woff는 옛 브라우저용이라 뺀다).
        // mjs: 선 지도(MapLibre)의 작업 파일
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest,woff2}'],
        cleanupOutdatedCaches: true,
        // 선 지도 조각·글자 조각은 받은 것을 30일 폰에 보관해 다시 볼 때 바로, 통신이 없는 산길에서도 보이게 (사양서 8.9)
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/map/tiles/') || url.pathname.startsWith('/map/fonts/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'gachitayo-line-map',
              expiration: { maxEntries: 3000, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200, 204] },
            },
          },
        ],
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
}));
