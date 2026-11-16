import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 카카오 로그인 (설계 5.5): 배포 때 GitHub 비밀값 두 개를 Worker 비밀값으로 넣는다. 값은 로그에 찍지 않는다
const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const step = ci.slice(ci.indexOf('- name: Worker 배포'), ci.indexOf('- name: 서버 응답 확인'));

describe('CI: 카카오 비밀값을 Worker에 넣기', () => {
  it('배포 단계 env에 두 비밀값이 있다', () => {
    expect(step).toContain('KAKAO_REST_API_KEY: ${{ secrets.KAKAO_REST_API_KEY }}');
    expect(step).toContain('KAKAO_CLIENT_SECRET: ${{ secrets.KAKAO_CLIENT_SECRET }}');
  });

  it('wrangler deploy에 --secrets-file로 넣는다', () => {
    expect(step).toMatch(/wrangler deploy[^\n]*--secrets-file/);
  });

  it('값을 출력하지 않는다', () => {
    expect(step).not.toMatch(/echo[^\n]*\$\{?KAKAO_/);
    expect(step).not.toMatch(/cat[^\n]*kakao/i);
  });

  it('배포 확인에서 카카오 providers를 본다', () => {
    expect(ci).toContain('/auth/providers');
  });
});
