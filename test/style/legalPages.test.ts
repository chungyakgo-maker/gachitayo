import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 개인정보처리방침·위치정보 이용약관 페이지 (사양서 13.3, 애플 심사·위치정보법). 내용은 초안, 법적 확인은 사용자가 받는다
const page = (name: string) => readFileSync(new URL(`../../public/${name}`, import.meta.url), 'utf8');

describe('약관 페이지 (사양서 13.3)', () => {
  it('개인정보처리방침: 수집 항목·보관·친구 제공·삭제 방법·문의(출시 전에 채움)', () => {
    const html = page('privacy.html');
    for (const t of ['닉네임', '익명 계정', '주행 기록', '코스', '친구 목록', '위치 공유', 'Cloudflare', '설정', '계정 삭제', '(출시 전에 채움)']) expect([t, html.includes(t)]).toEqual([t, true]);
    expect(html).toMatch(/<html lang="ko">/);
    // 검토 지적: 익명 계정이라 앱을 지우거나 폰을 바꾸면 이어 볼 수 없다 (사양서 12). 가입 때 IP는 하루 보관
    expect(html).not.toMatch(/다시 설치해도|폰을 바꾸거나 다시/);
    expect(html).toContain('IP 주소');
    expect(html).toContain('하루');
  });

  it('위치정보 이용약관: 수집 목적·보유 기간·친구 제공·이용자 권리', () => {
    const html = page('location-terms.html');
    for (const t of ['목적', '보유', '친구', '권리', '(출시 전에 채움)']) expect([t, html.includes(t)]).toEqual([t, true]);
  });
});
