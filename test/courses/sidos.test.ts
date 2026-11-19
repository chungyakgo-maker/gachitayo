// 모두의 코스 지역: 출발점으로 시·도를 짐작한다 (공개 창에서 바꿀 수 있다)
import { describe, expect, it } from 'vitest';
import { SIDOS, guessSido } from '../../src/courses/sidos';

describe('guessSido', () => {
  it('17개 시·도', () => {
    expect(SIDOS).toEqual(['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']);
  });
  it('대표 지점은 그 시·도', () => {
    expect(guessSido(37.5665, 126.978)).toBe('서울');
    expect(guessSido(37.88, 127.73)).toBe('강원');
    expect(guessSido(33.5, 126.53)).toBe('제주');
    expect(guessSido(35.18, 129.08)).toBe('부산');
    expect(guessSido(37.83, 128.2)).toBe('강원');
    expect(guessSido(37.27, 127.0)).toBe('경기');
  });
});
