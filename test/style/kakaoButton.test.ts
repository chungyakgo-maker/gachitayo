import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 카카오 로그인 버튼 (카카오 디자인 가이드): 노랑 #FEE500, 글자 검정 85%
const css = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1]!.trim() === '.kakao-btn');

describe('카카오 버튼 색', () => {
  it('배경 #FEE500, 글자 rgba(0, 0, 0, 0.85)', () => {
    expect(rule).toBeDefined();
    expect(rule![2]).toMatch(/background:\s*#fee500/i);
    expect(rule![2]).toMatch(/color:\s*rgba\(0,\s*0,\s*0,\s*0\.85\)/);
  });
});
