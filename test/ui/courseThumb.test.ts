import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CourseThumb, courseThumbPath } from '../../src/ui/components/CourseThumb';
import { COURSE_STYLE } from '../../src/ui/map/courseStyle';
import { BUILTIN_COURSES, builtinCourse } from '../../src/courses/builtin';
import { BUILTIN_POINTS } from '../../src/courses/builtinData';

describe('코스 썸네일 (사용자 요청)', () => {
  const b = BUILTIN_COURSES[0]!;
  const c = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: 'x', gateWidthM: 30 });

  it('코스 모양이 64px 안(여백 9px)에 들어가고, 출발·도착 점이 선 양 끝 근처', () => {
    const g = courseThumbPath(c, 64)!;
    const nums = g.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (const v of nums) expect(v).toBeGreaterThanOrEqual(8.9), expect(v).toBeLessThanOrEqual(55.1);
    expect(nums.length / 2).toBeLessThanOrEqual(130);
    const [x0, y0] = [nums[0]!, nums[1]!];
    expect(Math.hypot(g.start[0] - x0, g.start[1] - y0)).toBeLessThan(2);
    const [xe, ye] = [nums[nums.length - 2]!, nums[nums.length - 1]!];
    expect(Math.hypot(g.finish![0] - xe, g.finish![1] - ye)).toBeLessThan(2);
  });

  it('랩 코스는 도착 점 없이 선을 닫고, 중심선이 없으면 null', () => {
    const loop = { ...c, kind: 'loop' as const, finishGate: c.startGate };
    const g = courseThumbPath(loop, 64)!;
    expect(g.finish).toBeNull();
    expect(courseThumbPath({ ...c, centerline: null }, 64)).toBeNull();
  });
});

// 사용자 요청 "전체 지도·코스 리스트 경로는 이전 빨강으로 돌려라": 썸네일은 빨간 번짐 + 빨간 코스 선 (하늘색은 주행 지도만)
describe('코스 썸네일 색 (이전 빨강)', () => {
  const b = BUILTIN_COURSES[0]!;
  const c = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: 'x', gateWidthM: 30 });
  it('빨간 번짐 + 빨간 코스 선 + 가운데 밝은 줄', () => {
    const html = renderToStaticMarkup(createElement(CourseThumb, { course: c }));
    const strokes = [...html.matchAll(/<path[^>]*stroke="([^"]+)"/g)].map((m) => m[1]);
    expect(strokes).toEqual([COURSE_STYLE.glow, COURSE_STYLE.route, COURSE_STYLE.highlight]);
    expect(COURSE_STYLE.route).toBe('#ff453a');
  });
});
