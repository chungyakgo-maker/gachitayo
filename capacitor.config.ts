// 아이폰 앱 디고 (사양서 13.3): 웹앱을 Capacitor로 감싼다. 앱 빌드 결과(dist-app)를 ios/에 넣는다 (npm run cap:ios)
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'kr.dgo.app',
  appName: '디고',
  webDir: 'dist-app',
  // 앱을 켜고 화면을 그리기 전 바탕: 실행 화면 애니메이션과 같은 파란색 (깜빡임 없이, 2026-11-18)
  backgroundColor: '#3A86FF',
};

export default config;
