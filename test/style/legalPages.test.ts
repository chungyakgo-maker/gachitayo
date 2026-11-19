import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 개인정보처리방침·위치정보 이용약관 페이지 (사양서 13.3, 애플 심사·위치정보법). 내용은 초안, 법적 확인은 사용자가 받는다
const page = (name: string) => readFileSync(new URL(`../../public/${name}`, import.meta.url), 'utf8');

describe('약관 페이지 (사양서 13.3)', () => {
  it('개인정보처리방침: 수집 항목·보관·친구 제공·삭제 방법·문의(chungyakgo@gmail.com)·애플 로그인', () => {
    const html = page('privacy.html');
    for (const t of ['닉네임', '익명 계정', '주행 기록', '코스', '친구 목록', '위치 공유', 'Cloudflare', '설정', '계정 삭제', 'chungyakgo@gmail.com', '애플']) expect([t, html.includes(t)]).toEqual([t, true]);
    expect(html).toMatch(/<html lang="ko">/);
    // 검토 지적: 익명 계정이라 앱을 지우거나 폰을 바꾸면 이어 볼 수 없다 (사양서 12). 가입 때 IP는 하루 보관
    expect(html).not.toMatch(/다시 설치해도|폰을 바꾸거나 다시/);
    expect(html).toContain('IP 주소');
    expect(html).toContain('하루');
  });

  it('개인정보처리방침: 팀·프로필 사진 (설계 2026-11-18 team-drive)', () => {
    const html = page('privacy.html');
    for (const t of ['프로필 사진', '팀 이름', '팀원', '친구이거나 같은 팀']) expect([t, html.includes(t)]).toEqual([t, true]);
  });

  it('정식 앱(위치 공유 끔)에 맞는 문구: 정식 앱은 다른 이용자와 위치를 주고받지 않고, 위치 공유는 시험판에서만 (설계 2026-11-18 official-build)', () => {
    const pv = page('privacy.html');
    const lt = page('location-terms.html');
    for (const html of [pv, lt]) {
      // 기록은 폰에만·모두의 코스·팀 방 코스 기준 (2026-11-19 배포)
      expect(html).toContain('시행일 2026년 11월 19일');
      expect(html).toContain('정식 앱');
      expect(html).toContain('시험판');
      expect(html).toMatch(/정식 앱[^<]*다른 이용자와 위치를 주고받지 않/);
    }
    // 웹도 위치 공유를 끈다 (세영 "웹도 끔"): 시험판은 TestFlight 만
    for (const html of [pv, lt]) {
      expect(html).toContain('시험판(TestFlight)');
      expect(html).not.toContain('웹·TestFlight');
      expect(html).toMatch(/웹[^<]*정식 앱과 같/);
    }
    // 팀 목적지: 정식 앱 방장은 목적지(또는 코스 모양, 3부)만 보낸다 (경로는 각자 위치에서)
    expect(pv).toMatch(/목적지나 코스 모양만/);
    expect(lt).toMatch(/목적지만/);
    // 길찾기 때 지금 위치를 네이버 클라우드로 (위치정보 약관에도)
    expect(lt).toContain('네이버 클라우드');
    // 프로필 사진은 친구·같은 팀만
    expect(pv).toContain('프로필 사진');
  });

  it('위치정보 이용약관: 수집 목적·보유 기간·친구 제공·이용자 권리', () => {
    const html = page('location-terms.html');
    for (const t of ['목적', '보유', '친구', '권리', 'chungyakgo@gmail.com']) expect([t, html.includes(t)]).toEqual([t, true]);
  });
});

// 카톡 공유 미리보기 (사용자 요청 2026-11-18 "카톡공유할떄 링크가 안바뀐거임", 웹 이름도 디고 — 결정 (나)):
// 카톡은 링크한 웹 페이지의 공유 정보(og)를 읽어 제목·그림을 만든다
describe('웹 페이지 이름·공유 미리보기', () => {
  const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const meta = (prop: string) => index.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];

  it('이름은 디고 (같이타요 아님)', () => {
    expect(index).toMatch(/<title>디고<\/title>/);
    expect(meta('apple-mobile-web-app-title')).toBe('디고');
    expect(index).not.toContain('같이타요');
  });

  it('공유 미리보기: 제목·설명·새 로고 그림(절대 주소, 1200×630)', () => {
    expect(meta('og:title')).toBe('디고: 드라이브 코스 추천');
    expect(meta('og:description')).toBe('와인딩 랩타이머 · 팀 주행');
    expect(meta('og:image')).toBe('https://chungyakgo-maker.github.io/gachitayo/og-image.png');
    expect(meta('og:image:width')).toBe('1200');
    expect(meta('og:image:height')).toBe('630');
    expect(meta('og:url')).toBe('https://chungyakgo-maker.github.io/gachitayo/');
    expect(meta('twitter:card')).toBe('summary_large_image');
    const png = readFileSync(new URL('../../public/og-image.png', import.meta.url));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it('약관 페이지도 디고', () => {
    for (const n of ['privacy.html', 'location-terms.html']) expect([n, page(n).includes('같이타요')]).toEqual([n, false]);
  });
});

// 아이폰 앱 실행 화면 (2026-11-18): 켜는 순간부터 파란 바탕 → 실행 화면 애니메이션으로 깜빡임 없이 이어진다
describe('아이폰 앱 켜는 순간', () => {
  const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const cap = readFileSync(new URL('../../capacitor.config.ts', import.meta.url), 'utf8');
  it('앱 빌드에서만 첫 화면부터 실행 화면 파란색을 깐다 (웹은 그대로)', () => {
    expect(index).toMatch(/'%MODE%' === 'app'[^<]*classList\.add\('app-launch'\)/);
    expect(index).toMatch(/html\.app-launch,\s*html\.app-launch body\s*\{\s*background:\s*#3A86FF/);
    expect(cap).toMatch(/backgroundColor: '#3A86FF'/);
  });
});

