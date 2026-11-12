import { describe, expect, it } from 'vitest';
import { formatDuration, formatKst } from '../../src/ui/format';

describe('formatKst', () => {
  it('UTC 시각을 KST(UTC+9)로 표시한다', () => {
    expect(formatKst(Date.UTC(2026, 10, 12, 1, 5))).toBe('2026-11-12 10:05');
  });

  it('KST로 바꾸면서 날짜가 넘어가면 다음 날로 표시한다', () => {
    expect(formatKst(Date.UTC(2026, 11, 31, 15, 0))).toBe('2027-01-01 00:00');
  });
});

describe('formatDuration', () => {
  it('1시간 미만은 분:초', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
  });

  it('1시간 이상은 시:분:초', () => {
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
});

describe('주행 화면 표기 (M5 결정 4)', () => {
  it('랩타임: 끝난 랩은 소수 셋째 자리, 진행 중 랩은 첫째 자리', async () => {
    const { formatLapTime } = await import('../../src/ui/format');
    expect(formatLapTime(124_318, 3)).toBe('2:04.318');
    expect(formatLapTime(72_449, 1)).toBe('1:12.4');
    expect(formatLapTime(59_999, 1)).toBe('0:59.9');
    expect(formatLapTime(3_723_456, 3)).toBe('1:02:03.456');
    expect(formatLapTime(null, 3)).toBe('—');
  });

  it('델타: 부호와 소수 둘째 자리 (빼기는 − 기호)', async () => {
    const { formatDelta } = await import('../../src/ui/format');
    expect(formatDelta(-0.314)).toBe('−0.31');
    expect(formatDelta(0.425)).toBe('+0.43');
    expect(formatDelta(0)).toBe('±0.00');
    expect(formatDelta(null)).toBe('—');
    expect(formatDelta(-0.4471, 3)).toBe('−0.447');
  });

  it('날짜: 오늘이면 "오늘", 아니면 "11월 8일" (KST)', async () => {
    const { formatDayKst } = await import('../../src/ui/format');
    const now = Date.UTC(2026, 10, 12, 3, 0); // 11월 12일 12:00 KST
    expect(formatDayKst(Date.UTC(2026, 10, 12, 0, 0), now)).toBe('오늘');
    expect(formatDayKst(Date.UTC(2026, 10, 7, 16, 0), now)).toBe('11월 8일');
  });
});
