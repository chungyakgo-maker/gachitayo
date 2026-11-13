import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 노드로 읽는다 (Vitest는 CSS 가져오기를 비우므로)
const rawCss = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');

// 아이폰은 글자가 16px보다 작은 입력칸을 누르면 화면을 확대하고, 홈 화면 앱에서는 그대로 남아 아래 탭이 잘린다
// (사용자 신고 "사이즈 맞춤 오류, 메뉴바 잘림"). 입력칸·고르기 칸의 글자는 모두 16px 이상이어야 한다.
describe('입력칸 글자 크기 (아이폰 확대 막기)', () => {
  it('CSS 파일을 읽었다', () => expect(rawCss.length).toBeGreaterThan(10000));
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! }));
  const isField = (sel: string) => /(^|[\s,>+~])(input|select|textarea)\b|text-input/.test(sel);

  it('입력칸·고르기 칸 기본 글자는 16px', () => {
    const base = rules.find((r) => /^input, ?select, ?textarea$/.test(r.sel));
    expect(base?.body).toMatch(/font-size:\s*16px/);
  });

  it('입력칸을 고르는 규칙에 16px보다 작은 글자 크기가 없다', () => {
    const small = rules
      .filter((r) => isField(r.sel))
      .flatMap((r) => [...r.body.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => ({ sel: r.sel, px: Number(m[1]) })))
      .filter((x) => x.px < 16);
    expect(small).toEqual([]);
  });
});
