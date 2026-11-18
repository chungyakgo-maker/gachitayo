// 도움말 그림 (설계 docs/superpowers/specs/2026-11-18-help-design.md): 카드마다 그림이 있고, 크기 한도 안
import { existsSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HELP_CARDS } from '../../src/ui/help/helpCards';

const dir = new URL('../../public/help/', import.meta.url);
const size = (f: string) => statSync(new URL(f, dir)).size;

describe('도움말 그림 (public/help)', () => {
  it('카드마다 그림 파일이 있고, 움직이는 그림은 같은 이름 정지 그림도 있다', () => {
    for (const c of HELP_CARDS) {
      const f = c.media!.src.replace(/^help\//, '');
      expect([f, existsSync(new URL(f, dir))]).toEqual([f, true]);
      if (c.media!.kind === 'gif') expect(existsSync(new URL(f.replace(/\.gif$/, '.jpg'), dir))).toBe(true);
    }
  });

  it('크기: 사진 150 KB, 움직이는 그림 1.5 MB, 모두 합쳐 4 MB 이하', () => {
    const files = readdirSync(dir);
    for (const f of files.filter((x) => x.endsWith('.jpg'))) expect([f, size(f) <= 150 * 1024]).toEqual([f, true]);
    for (const f of files.filter((x) => x.endsWith('.gif'))) expect([f, size(f) <= 1.5 * 1024 * 1024]).toEqual([f, true]);
    expect(files.filter((x) => x.endsWith('.gif')).sort()).toEqual(['bike.gif', 'pace.gif']);
    expect(files.reduce((a, f) => a + size(f), 0)).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
});
