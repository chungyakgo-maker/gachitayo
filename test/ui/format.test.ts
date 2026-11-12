import { describe, expect, it } from 'vitest';
import { formatKst } from '../../src/ui/format';

describe('formatKst', () => {
  it('UTC 시각을 KST(UTC+9)로 표시한다', () => {
    expect(formatKst(Date.UTC(2026, 10, 12, 1, 5))).toBe('2026-11-12 10:05');
  });

  it('KST로 바꾸면서 날짜가 넘어가면 다음 날로 표시한다', () => {
    expect(formatKst(Date.UTC(2026, 11, 31, 15, 0))).toBe('2027-01-01 00:00');
  });
});
