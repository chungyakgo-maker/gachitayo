import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BUILTIN_COURSES, builtinCourse } from '../../src/courses/builtin';
import { BUILTIN_POINTS } from '../../src/courses/builtinData';
import type { Course } from '../../src/types/course';

const built = BUILTIN_COURSES.map((b, i) => builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: `b${i}`, gateWidthM: 30 }));
let courses: Course[] = [];
vi.mock('../../src/app/drive', () => ({ loadCourses: vi.fn(async () => courses), useDrive: () => ({ courses }) }));
vi.mock('../../src/ui/screens/useBestTimes', () => ({ useBestTimes: () => ({ b0: 512_345 }) }));

const { CoursesScreen } = await import('../../src/ui/screens/CoursesScreen');

describe('코스 탭: 내 코스 + 기본 코스 (사양서 7.5, 8.7)', () => {
  it('기본 코스가 정한 순서로, 편도·길이·어디서 어디로', () => {
    const mine = { ...built[0]!, id: 'm1', name: '인제 서킷', kind: 'loop' as const, builtin: undefined };
    courses = [mine, ...built];
    render(<CoursesScreen />);
    const own = screen.getByRole('region', { name: '내 코스' });
    expect(within(own).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#/course/m1']);
    const base = screen.getByRole('region', { name: '기본 코스' });
    const rows = within(base).getAllByRole('link');
    expect(rows.map((a) => a.getAttribute('href'))).toEqual(BUILTIN_COURSES.map((_, i) => `#/course/b${i}`));
    expect(rows[0]!.textContent).toContain('배후령');
    // 왼쪽 1:1 썸네일 (사용자 요청)
    expect(rows.every((r) => r.querySelector('.course-thumb svg path'))).toBe(true);
    expect(rows[0]!.textContent).toContain('배후령편도 · 8.5km춘천 → 화천내 베스트8:32.345');
    expect(rows[1]!.textContent).toContain('미시령 옛길');
    expect(rows[2]!.textContent).toContain('태백 → 만항재 쉼터');
    expect(rows[3]!.textContent).toContain('말티재편도 · 2.1km보은 → 말티재 전망대');
    expect(rows[4]!.textContent).toContain('구룡령편도 · 17.0km홍천 → 양양');
    expect(rows[7]!.textContent).toContain('북악스카이웨이편도 · 7.2km부암동 → 정릉');
    expect(rows[8]!.textContent).toContain('남한산성편도 · 3.8km성남 산성동 → 남한산성');
  });

  it('내 코스가 없으면 안내 한 줄, 기본 코스는 그대로', () => {
    courses = [...built];
    render(<CoursesScreen />);
    expect(within(screen.getByRole('region', { name: '내 코스' })).getByText('주행을 시작하면 첫 주행으로 내 코스를 만들어요.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '기본 코스' })).getAllByRole('link')).toHaveLength(BUILTIN_COURSES.length);
  });
});
