import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 아이폰 앱 디고 (사양서 13.3): Capacitor 설정과 iOS 설정 파일
const root = new URL('../../', import.meta.url);

describe('아이폰 앱 설정 (사양서 13.3)', () => {
  it('Capacitor 설정: 번들 ID com.dgo.app, 이름 디고, 앱 빌드 폴더 dist-app', async () => {
    const config = (await import('../../capacitor.config')).default;
    expect(config).toMatchObject({ appId: 'com.dgo.app', appName: '디고', webDir: 'dist-app' });
  });

  it('iOS 설정(Info.plist): 홈 화면 이름 디고, 위치·모션 권한 문구, 백그라운드 위치, 내비 앱 주소, 암호화 해당 없음', () => {
    const path = new URL('ios/App/App/Info.plist', root);
    expect(existsSync(path)).toBe(true);
    const plist = readFileSync(path, 'utf8');
    const value = (key: string) => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
    const array = (key: string) => [...(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(plist)?.[1] ?? '').matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
    expect(value('CFBundleDisplayName')).toBe('디고');
    expect(value('NSLocationWhenInUseUsageDescription')).toMatch(/위치/);
    expect(value('NSLocationAlwaysAndWhenInUseUsageDescription')).toMatch(/항상 허용/);
    expect(value('NSMotionUsageDescription')).toMatch(/모션/);
    expect(array('UIBackgroundModes')).toContain('location');
    expect(array('LSApplicationQueriesSchemes')).toEqual(expect.arrayContaining(['nmap', 'kakaomap']));
    expect(plist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
    // 블루투스는 넣지 않는다 (사용자: OBD 때 추가)
    expect(plist).not.toMatch(/NSBluetooth/);
  });
});
