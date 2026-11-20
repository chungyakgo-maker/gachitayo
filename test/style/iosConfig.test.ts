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

  it('Codemagic: 테스트 작업(위치 공유 켬, 1.1)과 정식 작업(위치 공유·간격 끔, 1.0.2 — 1.0.1 은 release-1.0.1 갈래, 2026-11-20 세영 "1.0.2에 넣게") 둘 (설계 2026-11-18 official-build, 세영 "정식·테스트 나눠야")', () => {
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
    // 테스트는 늘 정식보다 높은 번호 (1.1 = 테스트, 1.0.0 = 정식: TestFlight 에서 한눈에 구별, 정식 출시 뒤에도 테스트 빌드가 막히지 않게)
    expect(test).toMatch(/name: 디고 아이폰 테스트 \(위치 공유 켬\)/);
    expect(test).toMatch(/MARKETING_VERSION=1\.1"/);
    expect(release).toMatch(/name: 디고 아이폰 정식/);
    expect(release).toMatch(/VITE_LOCATION_SHARING: ['"]?off/);
    expect(release).toMatch(/VITE_LIVE_GAP: ['"]?off/);
    expect(release).toMatch(/MARKETING_VERSION=1\.0\.2"/);
    expect(release).toMatch(/VITE_API_URL: https:\/\/gachitayo-api\.chungyakgo\.workers\.dev/);
    expect(release).toMatch(/bundle_identifier: kr\.dgo\.app/);
  });

  it('아래 탭 유리 알약 (1.0.2, 2026-11-20): NativeTabBar.swift 가 앱에 묶이고, 플러그인 등록·html 표시(native-tabs)를 한다', () => {
    const pbx = readFileSync(new URL('ios/App/App.xcodeproj/project.pbxproj', root), 'utf8');
    expect(pbx).toMatch(/\/\* NativeTabBar\.swift in Sources \*\/ = \{isa = PBXBuildFile/);
    expect(pbx).toMatch(/\/\* NativeTabBar\.swift \*\/ = \{isa = PBXFileReference[^}]*path = NativeTabBar\.swift/);
    const sources = pbx.slice(pbx.indexOf('Begin PBXSourcesBuildPhase'), pbx.indexOf('End PBXSourcesBuildPhase'));
    expect(sources).toMatch(/NativeTabBar\.swift in Sources/);
    const vc = readFileSync(new URL('ios/App/App/MainViewController.swift', root), 'utf8');
    expect(vc).toMatch(/registerPluginInstance\(DgoTabBarPlugin\(\)\)/);
    expect(vc).toMatch(/classList\.add\('native-tabs'\)/);
    expect(vc).toMatch(/nativeTabs\.attach\(to: view, page: webView\)/);
    const bar = readFileSync(new URL('ios/App/App/NativeTabBar.swift', root), 'utf8');
    // 사이트와 같은 이름·탭 경로·크기 (src/app/nativeTabs.ts, styles.css --native-tab-h)
    expect(bar).toMatch(/jsName = "DgoTabBar"/);
    expect(bar).toMatch(/dgo:native-tab/);
    for (const path of ['"/"', '"/courses"', '"/history"', '"/settings"']) expect(bar).toContain(path);
    expect(bar).toMatch(/cellW: CGFloat = 70/);
    expect(bar).toMatch(/cellH: CGFloat = 54/);
    expect(bar).toMatch(/max\(10, host\.safeAreaInsets\.bottom - 18\)/);
    // 새 iOS 이름(리퀴드 글래스)은 빌드 도구가 알 때만
    expect(bar).toMatch(/#if compiler\(>=6\.2\)[\s\S]*UIGlassEffect/);
  });

  it('흔들어서 실행 취소를 끈다 (2026-11-18 실차: 주행 중 진동에 "Undo 입력" 창이 떴다)', () => {
    const d = readFileSync(new URL('ios/App/App/AppDelegate.swift', root), 'utf8');
    expect(d).toMatch(/application\.applicationSupportsShakeToEdit = false/);
  });

  it('웹 배포도 위치 공유·간격 끔 (세영 "웹도 끔")', () => {
    const ci = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
    const pages = ci.slice(ci.indexOf('GitHub Pages 배포'), ci.indexOf('서버(Worker·D1·R2) 배포'));
    expect(pages).toMatch(/VITE_LOCATION_SHARING: 'off'/);
    expect(pages).toMatch(/VITE_LIVE_GAP: 'off'/);
  });
});
