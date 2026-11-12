// 코스 출발점·도착점을 내비 앱으로 열기 (사양서 8.7, 사용자 요청).
// 네이버 지도: nmap://navigation 으로 바로 길안내 (앱 키 필요 없음, appname은 이 웹페이지 주소).
// 카카오: 카카오내비를 바로 여는 공식 방법은 카카오 개발자 앱 키가 있어야 해서(JavaScript SDK),
// 키 없이 되는 카카오맵 자동차 길찾기(kakaomap://route)로 연다. 카카오맵에서 "안내 시작"을 누르면 길안내.
// 안드로이드는 intent:// 로 열어 앱이 없으면 크롬이 대신 갈 곳(설치 화면·웹 길찾기)으로 간다.

export type NavApp = 'naver' | 'kakao';
export type Platform = 'ios' | 'android' | 'other';

export interface NavPoint {
  lat: number;
  lon: number;
  /** 목적지 이름 (예: "배후령 출발") */
  name: string;
}

export const NAV_APP_LABEL: Record<NavApp, string> = { naver: '네이버 지도', kakao: '카카오맵' };
/** "~로/으로" 붙인 이름 (화면 읽기 글) */
export const NAV_APP_WITH: Record<NavApp, string> = { naver: '네이버 지도로', kakao: '카카오맵으로' };

const STORE: Record<NavApp, { ios: string; android: string; pkg: string }> = {
  naver: { ios: 'https://apps.apple.com/kr/app/id311867728', android: 'https://play.google.com/store/apps/details?id=com.nhn.android.nmap', pkg: 'com.nhn.android.nmap' },
  kakao: { ios: 'https://apps.apple.com/kr/app/id304608425', android: 'https://play.google.com/store/apps/details?id=net.daum.android.map', pkg: 'net.daum.android.map' },
};

export function platformOf(ua: string): Platform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua))) return 'ios';
  return 'other';
}

/** 앱 설치 화면 (안드로이드는 플레이 스토어, 그 밖에는 앱 스토어) */
export function storeUrl(app: NavApp, platform: Platform): string {
  return platform === 'android' ? STORE[app].android : STORE[app].ios;
}

const fix = (v: number) => v.toFixed(6);
const enc = encodeURIComponent;

/** 카카오맵 웹 길찾기 (앱이 없을 때). 이름에 쉼표가 있으면 주소가 깨지므로 뺀다 */
export function kakaoWebUrl(p: NavPoint): string {
  return `https://map.kakao.com/link/to/${enc(p.name.replace(/,/g, ' '))},${fix(p.lat)},${fix(p.lon)}`;
}

/** 앱을 여는 주소. appname은 네이버 지도가 요구하는 호출한 곳 이름 (웹이면 웹페이지 주소) */
export function navUrl(app: NavApp, p: NavPoint, platform: Platform, appname: string): string {
  const pathQuery =
    app === 'naver'
      ? `navigation?dlat=${fix(p.lat)}&dlng=${fix(p.lon)}&dname=${enc(p.name)}&appname=${enc(appname)}`
      : `route?ep=${fix(p.lat)},${fix(p.lon)}&by=CAR`;
  const scheme = app === 'naver' ? 'nmap' : 'kakaomap';
  if (platform !== 'android') return `${scheme}://${pathQuery}`;
  const fallback = app === 'naver' ? STORE.naver.android : kakaoWebUrl(p);
  return `intent://${pathQuery}#Intent;scheme=${scheme};package=${STORE[app].pkg};S.browser_fallback_url=${enc(fallback)};end`;
}
