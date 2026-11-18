import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 아이폰 앱 디고 (사양서 13.3): Capacitor 설정과 iOS 설정 파일
const root = new URL('../../', import.meta.url);

describe('아이폰 앱 설정 (사양서 13.3)', () => {
  it('Capacitor 설정: 번들 ID kr.dgo.app, 이름 디고, 앱 빌드 폴더 dist-app', async () => {
    const config = (await import('../../capacitor.config')).default;
    expect(config).toMatchObject({ appId: 'kr.dgo.app', appName: '디고', webDir: 'dist-app' });
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
    // 프로필 사진 고르기 (설계 2026-11-18 team-drive): 사진 고르기 창의 "사진 찍기"가 카메라를 쓴다. 문구가 없으면 앱이 꺼진다
    expect(value('NSCameraUsageDescription')).toMatch(/프로필 사진/);
    expect(value('NSPhotoLibraryUsageDescription')).toMatch(/프로필 사진/);
    // 블루투스는 넣지 않는다 (사용자: OBD 때 추가)
    expect(plist).not.toMatch(/NSBluetooth/);
  });

  it('Codemagic: 테스트 작업(위치 공유 켬, 1.0)과 정식 작업(위치 공유·간격 끔, 1.0.0) 둘 (설계 2026-11-18 official-build)', () => {
    const y = readFileSync(new URL('codemagic.yaml', root), 'utf8');
    const block = (id: string) => {
      const i = y.indexOf(`\n  ${id}:`);
      expect([id, i >= 0]).toEqual([id, true]);
      // 다음 작업(또는 그 위 주석)이 시작하는 곳까지 — 두 칸 들여쓴 첫 줄
      const next = y.slice(i + 1).search(/\n  \S/);
      return next < 0 ? y.slice(i) : y.slice(i, i + 1 + next);
    };
    const test = block('ios-testflight');
    const release = block('ios-release');
    expect(test).not.toMatch(/VITE_LOCATION_SHARING/);
    expect(test).not.toMatch(/MARKETING_VERSION/);
    expect(release).toMatch(/name: 디고 아이폰 정식/);
    expect(release).toMatch(/VITE_LOCATION_SHARING: ['"]?off/);
    expect(release).toMatch(/VITE_LIVE_GAP: ['"]?off/);
    expect(release).toMatch(/MARKETING_VERSION=1\.0\.0/);
    expect(release).toMatch(/VITE_API_URL: https:\/\/gachitayo-api\.chungyakgo\.workers\.dev/);
    expect(release).toMatch(/bundle_identifier: kr\.dgo\.app/);
  });

  it('웹 배포도 위치 공유·간격 끔 (세영 "웹도 끔")', () => {
    const ci = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
    const pages = ci.slice(ci.indexOf('GitHub Pages 배포'), ci.indexOf('서버(Worker·D1·R2) 배포'));
    expect(pages).toMatch(/VITE_LOCATION_SHARING: 'off'/);
    expect(pages).toMatch(/VITE_LIVE_GAP: 'off'/);
  });
});
