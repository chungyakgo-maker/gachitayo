// 도움말 · 기능 알아보기 카드 (설계 docs/superpowers/specs/2026-11-18-help-design.md): 정식 기준, 친구 위치 공유 없음, GIF 2개
import { describe, expect, it } from 'vitest';
import { HELP_CARDS, HELP_START } from '../../src/ui/help/helpCards';

describe('기능 알아보기 카드', () => {
  it('설계 표 순서대로 8장', () => {
    expect(HELP_CARDS.map((c) => c.id)).toEqual(['lap', 'pace', 'dest', 'course', 'team', 'bike', 'history', 'screen']);
    expect(HELP_START).toHaveLength(3);
  });

  it('움직이는 그림(GIF)은 커브 표지판·바이크 둘뿐, 나머지는 스크린샷', () => {
    expect(HELP_CARDS.filter((c) => c.media?.kind === 'gif').map((c) => c.id)).toEqual(['pace', 'bike']);
    for (const c of HELP_CARDS) {
      expect(c.media).not.toBeNull();
      expect(c.media!.src).toBe(`help/${c.id}.${c.media!.kind}`);
    }
  });

  it('카드마다 제목·칩 이름·설명 2~3줄', () => {
    for (const c of HELP_CARDS) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.chip.length).toBeGreaterThan(0);
      expect(c.lines.length).toBeGreaterThanOrEqual(2);
      expect(c.lines.length).toBeLessThanOrEqual(3);
    }
  });

  it('정식 기준: 위치 공유 설명이 없다 (세영 "친구 위치 공유기능은 빼")', () => {
    const all = [...HELP_START, ...HELP_CARDS.flatMap((c) => [c.title, c.chip, ...c.lines, c.link?.label ?? ''])].join('\n');
    expect(all).not.toMatch(/위치 공유|앞 친구|친구 위치/);
  });

  it('바로 가기: 목적지·코스·바이크(설정)·기록', () => {
    const link = (id: string) => HELP_CARDS.find((c) => c.id === id)?.link?.href ?? null;
    expect(link('dest')).toBe('#/destination');
    expect(link('course')).toBe('#/courses');
    expect(link('bike')).toBe('#/settings');
    expect(link('history')).toBe('#/history');
  });
});
