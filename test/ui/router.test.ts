import { describe, expect, it } from 'vitest';
import { parseHashPath } from '../../src/ui/router';

describe('parseHashPath', () => {
  it('해시가 비어 있으면 홈 경로', () => {
    expect(parseHashPath('')).toBe('/');
    expect(parseHashPath('#')).toBe('/');
    expect(parseHashPath('#/')).toBe('/');
  });

  it('쿼리 문자열은 경로에서 뺀다', () => {
    expect(parseHashPath('#/courses?sort=name')).toBe('/courses');
  });

  it('맨 앞 슬래시가 없어도 같은 경로로 본다', () => {
    expect(parseHashPath('#courses')).toBe('/courses');
  });
});
