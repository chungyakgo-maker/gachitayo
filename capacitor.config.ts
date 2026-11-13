// 아이폰 앱 디고 (사양서 13.3): 웹앱을 Capacitor로 감싼다. 앱 빌드 결과(dist-app)를 ios/에 넣는다 (npm run cap:ios)
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dgo.app',
  appName: '디고',
  webDir: 'dist-app',
  backgroundColor: '#000000',
};

export default config;
