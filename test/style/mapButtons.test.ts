import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 노드로 읽는다 (Vitest는 CSS 가져오기를 비우므로)
const rawCss = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! }));
const px = (body: string, prop: string) => Number(body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([\\d.]+)px`))?.[1]);

// 사용자 요청 "다 똑같이 맞춰": 지도 GPS 버튼은 주행·재생·메인 지도 모두 나침반과 같은 32 px
describe('지도 버튼 크기 (나침반·GPS 32 px, 모든 지도 같게)', () => {
  it('나침반 동그라미 32 px', () => {
    const dial = rules.find((r) => r.sel === '.map-compass .dial')!;
    expect([px(dial.body, 'width'), px(dial.body, 'height')]).toEqual([32, 32]);
  });

  it('GPS 버튼 기본 규칙이 32 px이고, 다른 크기로 덮는 규칙이 없다 (메인 지도 포함)', () => {
    const base = rules.find((r) => r.sel === '.map-gps')!;
    expect([px(base.body, 'width'), px(base.body, 'height')]).toEqual([32, 32]);
    const other = rules
      .filter((r) => /\.map-gps\b(?![\w-])(?!\s+svg)/.test(r.sel) && r.sel !== '.map-gps')
      .filter((r) => /(^|[;\s])(width|height):/.test(r.body));
    expect(other.map((r) => r.sel)).toEqual([]);
  });

  it('종료 버튼: 지금의 1/3 너비로 가운데, 지도 모드에서는 맨 아래 10 px (사용자 요청)', () => {
    const btn = rules.find((r) => r.sel === '.end-btn')!;
    expect(btn.body).toMatch(/width:\s*33%/);
    expect(btn.body).toMatch(/align-self:\s*center/);
    const bottom = rules.find((r) => r.sel === '.drive.mode-map .drive-map .drive-bottom')!;
    expect(bottom.body).toMatch(/padding-bottom:\s*10px/);
  });
});
