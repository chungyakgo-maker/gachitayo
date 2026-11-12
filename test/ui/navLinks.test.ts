import { describe, expect, it } from 'vitest';
import { kakaoWebUrl, navUrl, platformOf, storeUrl } from '../../src/ui/navLinks';

const P = { lat: 37.9578174, lon: 127.7796332, name: '배후령 출발' };
const APP = 'https://chungyakgo-maker.github.io/gachitayo/';

describe('내비 앱으로 열기 (사양서 8.7)', () => {
  it('폰 종류', () => {
    expect(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Linux; Android 15; SM-S928N)')).toBe('android');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile/15E148')).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0)')).toBe('other');
  });

  it('네이버 지도: 바로 길안내 (목적지 좌표·이름, 호출한 곳 이름)', () => {
    expect(navUrl('naver', P, 'ios', APP)).toBe(
      `nmap://navigation?dlat=37.957817&dlng=127.779633&dname=${encodeURIComponent('배후령 출발')}&appname=${encodeURIComponent(APP)}`,
    );
  });

  it('카카오맵: 자동차 길찾기 (현재 위치 → 목적지)', () => {
    expect(navUrl('kakao', P, 'ios', APP)).toBe('kakaomap://route?ep=37.957817,127.779633&by=CAR');
  });

  it('안드로이드: intent로 열고, 앱이 없으면 네이버는 플레이 스토어, 카카오는 웹 길찾기', () => {
    const n = navUrl('naver', P, 'android', APP);
    expect(n.startsWith('intent://navigation?dlat=37.957817&dlng=127.779633&')).toBe(true);
    expect(n).toContain('#Intent;scheme=nmap;package=com.nhn.android.nmap;S.browser_fallback_url=');
    expect(decodeURIComponent(n.split('S.browser_fallback_url=')[1]!.replace(/;end$/, ''))).toBe('https://play.google.com/store/apps/details?id=com.nhn.android.nmap');
    const k = navUrl('kakao', P, 'android', APP);
    expect(k.startsWith('intent://route?ep=37.957817,127.779633&by=CAR#Intent;scheme=kakaomap;package=net.daum.android.map;')).toBe(true);
    expect(decodeURIComponent(k.split('S.browser_fallback_url=')[1]!.replace(/;end$/, ''))).toBe(kakaoWebUrl(P));
    expect(k.endsWith(';end')).toBe(true);
  });

  it('카카오맵 웹 길찾기: 이름의 쉼표는 뺀다', () => {
    expect(kakaoWebUrl({ ...P, name: '배후령, 출발' })).toBe(`https://map.kakao.com/link/to/${encodeURIComponent('배후령  출발')},37.957817,127.779633`);
  });

  it('설치 화면', () => {
    expect(storeUrl('naver', 'ios')).toBe('https://apps.apple.com/kr/app/id311867728');
    expect(storeUrl('kakao', 'android')).toBe('https://play.google.com/store/apps/details?id=net.daum.android.map');
  });
});
